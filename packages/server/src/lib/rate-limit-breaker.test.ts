import { test, expect } from "bun:test";
import {
    recordRateLimitFailure,
    checkCooldown,
    modelKey,
    isRateLimitError,
    RateLimitCooldownError,
} from "./rate-limit-breaker";

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

test("isRateLimitError detects the ai SDK RetryError -> lastError -> APICallError shape", () => {
    // Mirrors what `ai`'s streamText actually throws after 3 failed attempts:
    // a RetryError whose .lastError is the real APICallError carrying the
    // 429 and the OpenRouter response body. Before this fix, isRateLimitError
    // only looked at the top-level object and never unwrapped .lastError, so
    // this exact shape (the one in production) was silently missed.
    const apiCallError = {
        name: "AI_APICallError",
        message: "Provider returned error",
        statusCode: 429,
        url: "https://openrouter.ai/api/v1/chat/completions",
        responseBody: JSON.stringify({
            error: {
                message: "Provider returned error",
                code: 429,
                metadata: {
                    raw: "z-ai/glm-5.2:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations",
                    provider_name: "Decart",
                    provider_error_code: "upstream_429",
                },
            },
        }),
    };
    const retryError = {
        name: "AI_RetryError",
        message: "Failed after 3 attempts. Last error: AI_APICallError: Provider returned error",
        lastError: apiCallError,
    };

    expect(isRateLimitError(retryError)).toBe(true);
    // Also covers reaching the model purely via the human-readable message,
    // in case a future SDK version stops attaching statusCode this deeply.
    expect(isRateLimitError({ message: retryError.message + " — Decart: z-ai/glm-5.2:free is temporarily rate-limited upstream." })).toBe(true);
});

test("RateLimitCooldownError carries model id and retry-after for the caller", () => {
    const err = new RateLimitCooldownError("z-ai/glm-5.2:free", 42);
    expect(err).toBeInstanceOf(Error);
    expect(err.modelId).toBe("z-ai/glm-5.2:free");
    expect(err.retryAfterSeconds).toBe(42);
    expect(err.message).toContain("z-ai/glm-5.2:free");
    expect(err.message).toContain("42s");
});

test("breaker end-to-end: record a failure from a real RetryError shape, then see the cooldown", () => {
    const key = modelKey("custom", "z-ai/glm-5.2:free");
    expect(checkCooldown(key).onCooldown).toBe(false);

    const err = { lastError: { statusCode: 429 } };
    expect(isRateLimitError(err)).toBe(true);
    recordRateLimitFailure(key);

    const status = checkCooldown(key);
    expect(status.onCooldown).toBe(true);
});