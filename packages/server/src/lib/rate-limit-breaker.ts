// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

// Per-model circuit breaker for upstream rate-limit errors.
//
// Why this exists: without it, a single rate-limited model (most often a
// shared free tier like an OpenRouter `:free` model) keeps getting hit again
// on the very next turn, and again on every step of every subagent `task`
// call in the same turn (subagents can run up to 30 steps). Each of those
// calls re-fails against a limit that hasn't reset yet, which is what makes
// it look like "the models hit their limits very fast" — it's not one call
// hitting the limit, it's dozens of calls in quick succession all hitting
// the *same already-tripped* limit.
//
// This module tracks a short cooldown per (provider, modelId) after a
// rate-limit error is observed. Callers check the cooldown BEFORE making a
// network call and skip/fallback instead of re-attempting a call that's
// almost certain to fail.

const cooldowns = new Map<string, number>(); // key -> cooldown-expires-at (epoch ms)

function getCooldownMs(): number {
    const configured = Number.parseInt(process.env.ANCIENT_RATE_LIMIT_COOLDOWN_MS ?? "60000", 10);
    return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}

/** Stable key for a resolved model — provider + modelId is specific enough:
 * the upstream rate limit is shared per model regardless of which local
 * BYOK connection row resolved to it. */
export function modelKey(provider: string, modelId: string): string {
    return `${provider}:${modelId}`;
}

export type CooldownStatus =
    | { onCooldown: false }
    | { onCooldown: true; retryAfterSeconds: number };

export function checkCooldown(key: string): CooldownStatus {
    const expiresAt = cooldowns.get(key);
    if (!expiresAt) return { onCooldown: false };
    const now = Date.now();
    if (now >= expiresAt) {
        cooldowns.delete(key);
        return { onCooldown: false };
    }
    return { onCooldown: true, retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - now) / 1000)) };
}

export function recordRateLimitFailure(key: string): void {
    cooldowns.set(key, Date.now() + getCooldownMs());
}

/** Best-effort detection of "this failed because of an upstream rate limit"
 * across the various shapes errors take once the ai SDK (and gateways like
 * OpenRouter) have wrapped/unwrapped them. Duck-typed on purpose — retries
 * and wrapping can lose the exact error class identity while these fields
 * and phrases survive. */
export function isRateLimitError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;

    const statusCode = (err as { statusCode?: unknown }).statusCode;
    if (statusCode === 429) return true;

    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === "object") {
        const causeStatusCode = (cause as { statusCode?: unknown }).statusCode;
        if (causeStatusCode === 429) return true;
    }

    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") {
        const lower = message.toLowerCase();
        if (lower.includes("rate limit") || lower.includes("too many requests")) return true;
    }

    return false;
}