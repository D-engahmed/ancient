// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Per-model circuit breaker for upstream rate-limit errors (infrastructure).
//
// Ported from the server's local rate-limit-breaker and promoted into the
// infrastructure layer so the engine, strategies, and gateway all share ONE
// breaker instead of each keeping its own cooldown map.
//
// Why it exists: without it, a single rate-limited model (most often a shared
// free tier like an OpenRouter `:free` model) keeps getting hit again on the
// very next turn, and again on every step of every subagent `task` call in the
// same turn. Each of those calls re-fails against a limit that hasn't reset
// yet. This module tracks a short cooldown per (provider, modelId) after a
// rate-limit error, and callers check it BEFORE making a network call.

const cooldowns = new Map<string, number>(); // key -> cooldown-expires-at (epoch ms)

function getCooldownMs(): number {
    const configured = Number.parseInt(process.env.ANCIENT_RATE_LIMIT_COOLDOWN_MS ?? "60000", 10);
    return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}

/** Stable key for a resolved model — provider + modelId is specific enough. */
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

/** Thrown by callers that check the breaker BEFORE a network call and find the
 * model already on cooldown. Carries enough detail for a route handler to
 * answer with 429 + Retry-After instead of a generic 500. */
export class RateLimitCooldownError extends Error {
    readonly modelId: string;
    readonly retryAfterSeconds: number;

    constructor(modelId: string, retryAfterSeconds: number) {
        super(
            `${modelId} was rate-limited recently and is on a short cooldown (~${retryAfterSeconds}s left). ` +
            `Retry shortly, pick a different model, or configure an automatic fallback so requests ` +
            `route around a rate-limited provider.`,
        );
        this.name = "RateLimitCooldownError";
        this.modelId = modelId;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

/** Best-effort detection of "this failed because of an upstream rate limit"
 * across the various shapes errors take once the AI SDK (and gateways like
 * OpenRouter) have wrapped/unwrapped them. Duck-typed on purpose — retries
 * and wrapping can lose the exact error class identity while these fields and
 * phrases survive. Recurses into `.lastError` and `.cause` to a fixed depth.
 * See the server's rate-limit-breaker for the full failure-history note. */
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
