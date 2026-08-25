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

/** Thrown by callers that check the breaker BEFORE making a network call and
 * find the model already on cooldown. Carries enough detail for a route
 * handler to answer with 429 + Retry-After instead of a generic 500, and for
 * the free-lane router to fall back to the user's selected model. */
export class RateLimitCooldownError extends Error {
    readonly modelId: string;
    readonly retryAfterSeconds: number;

    constructor(modelId: string, retryAfterSeconds: number) {
        super(
            `${modelId} was rate-limited recently and is on a short cooldown (~${retryAfterSeconds}s left). ` +
            `Retry shortly, pick a different model, or configure ANCIENT_OPENROUTER_FALLBACK_MODELS so requests ` +
            `route around a rate-limited provider automatically.`,
        );
        this.name = "RateLimitCooldownError";
        this.modelId = modelId;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

/** Best-effort detection of "this failed because of an upstream rate limit"
 * across the various shapes errors take once the ai SDK (and gateways like
 * OpenRouter) have wrapped/unwrapped them. Duck-typed on purpose — retries
 * and wrapping can lose the exact error class identity while these fields
 * and phrases survive.
 *
 * Recurses into `.lastError` (ai SDK's RetryError wraps the final underlying
 * failure there) and `.cause`, up to a small fixed depth, because the object
 * that actually carries `statusCode: 429` is very often not the one the
 * caller catches directly — it's nested one or two levels down. A version
 * that only checked the top-level object and one level of `.cause` missed
 * exactly this shape (RetryError -> lastError -> APICallError), which is why
 * the breaker previously never tripped for gateway errors like the
 * "z-ai/glm-5.2:free is temporarily rate-limited upstream" case: the
 * hyphenated "rate-limited" also didn't match the old "rate limit" (space)
 * substring check. */
export function isRateLimitError(err: unknown, depth = 0): boolean {
    if (!err || typeof err !== "object" || depth > 4) return false;

    const statusCode = (err as { statusCode?: unknown }).statusCode;
    if (statusCode === 429) return true;

    const message = (err as { message?: unknown }).message;
    const responseBody = (err as { responseBody?: unknown }).responseBody;
    for (const text of [message, responseBody]) {
        if (typeof text !== "string") continue;
        const lower = text.toLowerCase();
        if (
            lower.includes("rate limit") ||
            lower.includes("rate-limit") ||
            lower.includes("too many requests") ||
            lower.includes("\"code\":429") ||
            lower.includes("upstream_429")
        ) {
            return true;
        }
    }

    const lastError = (err as { lastError?: unknown }).lastError;
    if (lastError && lastError !== err && isRateLimitError(lastError, depth + 1)) return true;

    const cause = (err as { cause?: unknown }).cause;
    if (cause && cause !== err && isRateLimitError(cause, depth + 1)) return true;

    return false;
}