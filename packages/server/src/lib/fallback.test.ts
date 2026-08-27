import { test, expect } from "bun:test";
import { pickHealthyFallback, asFallbackCandidate } from "./fallback";
import { recordRateLimitFailure, checkCooldown, modelKey } from "./rate-limit-breaker";
import type { ResolvedModel } from "./models";

function fakeResolved(modelId: string, provider = "custom"): ResolvedModel {
    return { model: {} as never, provider: provider as never, modelId, apiKey: undefined };
}

function primeCooldown(modelId: string, provider = "custom") {
    recordRateLimitFailure(modelKey(provider, modelId));
}

test("pickHealthyFallback picks the first healthy candidate when the primary is rate-limited", () => {
    const primaryKey = modelKey("custom", "user-chosen-model");
    const free = fakeResolved("free-fallback");

    const picked = pickHealthyFallback(
        [asFallbackCandidate(free, true)],
        primaryKey,
    );
    expect(picked).not.toBeNull();
    expect(picked?.resolved.modelId).toBe("free-fallback");
    expect(picked?.isFree).toBe(true);
});

test("pickHealthyFallback returns the free model before the builtin default (priority order)", () => {
    const free = fakeResolved("free-fallback");
    const builtin = fakeResolved("gpt-default", "openai");

    const picked = pickHealthyFallback(
        [asFallbackCandidate(free, true), asFallbackCandidate(builtin, false)],
        modelKey("custom", "primary"),
    );
    expect(picked?.resolved.modelId).toBe("free-fallback");
    expect(picked?.isFree).toBe(true);
});

test("pickHealthyFallback skips a candidate that is on cooldown and picks the next healthy one", () => {
    const free = fakeResolved("free-on-cooldown");
    const builtin = fakeResolved("gpt-default", "openai");
    primeCooldown("free-on-cooldown");

    const picked = pickHealthyFallback(
        [asFallbackCandidate(free, true), asFallbackCandidate(builtin, false)],
        modelKey("custom", "primary"),
    );
    expect(picked).not.toBeNull();
    expect(picked?.resolved.modelId).toBe("gpt-default");
    expect(picked?.isFree).toBe(false);
});

test("pickHealthyFallback never returns a candidate on cooldown, even if it is the only one", () => {
    const free = fakeResolved("free-on-cooldown");
    primeCooldown("free-on-cooldown");

    const picked = pickHealthyFallback(
        [asFallbackCandidate(free, true)],
        modelKey("custom", "primary"),
    );
    expect(picked).toBeNull();
});

test("pickHealthyFallback returns null when all candidates are on cooldown", () => {
    const free = fakeResolved("free-cd");
    const builtin = fakeResolved("gpt-cd", "openai");
    primeCooldown("free-cd");
    primeCooldown("gpt-cd", "openai");

    const picked = pickHealthyFallback(
        [asFallbackCandidate(free, true), asFallbackCandidate(builtin, false)],
        modelKey("custom", "primary"),
    );
    expect(picked).toBeNull();
});

test("pickHealthyFallback returns null for an empty candidate list", () => {
    const picked = pickHealthyFallback([], modelKey("custom", "primary"));
    expect(picked).toBeNull();
});

test("pickHealthyFallback never falls back to the primary model itself (same key)", () => {
    const primary = fakeResolved("primary-model");
    const primaryKey = modelKey(primary.provider, primary.modelId);

    // The primary IS the user-chosen model; it must not be echoed back.
    const picked = pickHealthyFallback([asFallbackCandidate(primary, true)], primaryKey);
    expect(picked).toBeNull();
});

test("asFallbackCandidate derives a key the breaker recognizes for cooldown tracking", () => {
    const cand = asFallbackCandidate(fakeResolved("track-this"), true);
    // Putting it on cooldown via the derived key must be observed by checkCooldown.
    expect(checkCooldown(cand.key).onCooldown).toBe(false);
    recordRateLimitFailure(cand.key);
    expect(checkCooldown(cand.key).onCooldown).toBe(true);
});
