import { test, expect } from "bun:test";
import { recordRateLimitFailure, checkCooldown, modelKey, isRateLimitError } from "./rate-limit-breaker";

test("cooldown blocks calls after a recorded 429", () => {
    const key = modelKey("openrouter", "free-model");

    // Should not be on cooldown initially
    expect(checkCooldown(key).onCooldown).toBe(false);

    // Record a failure
    recordRateLimitFailure(key);

    // Should now be on cooldown
    const status = checkCooldown(key);
    expect(status.onCooldown).toBe(true);
    if (status.onCooldown) {
        expect(status.retryAfterSeconds).toBeGreaterThan(0);
    }
});

test("isRateLimitError detects various 429 shapes", () => {
    expect(isRateLimitError({ statusCode: 429 })).toBe(true);
    expect(isRateLimitError({ cause: { statusCode: 429 } })).toBe(true);
    expect(isRateLimitError(new Error("Rate limit exceeded"))).toBe(true);
    expect(isRateLimitError(new Error("Too many requests"))).toBe(true);
    expect(isRateLimitError(new Error("Internal server error"))).toBe(false);
});