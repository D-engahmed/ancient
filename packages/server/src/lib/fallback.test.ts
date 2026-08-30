import { test, expect } from "bun:test";
import { pickHealthyFallback, asFallbackCandidate, selectHealthyFallbackModel } from "./fallback";
import { recordRateLimitFailure, checkCooldown, modelKey } from "./rate-limit-breaker";
import type { ResolvedModel } from "./models";
import type { AncientSettings } from "../hooks/settings";

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

test("selectHealthyFallbackModel adopts the configured free model when the primary is on cooldown", () => {
    const prevBase = process.env.ANCIENT_FREE_MODEL_BASE_URL;
    const prevId = process.env.ANCIENT_FREE_MODEL_ID;
    try {
        process.env.ANCIENT_FREE_MODEL_BASE_URL = "http://localhost:11434/v1";
        process.env.ANCIENT_FREE_MODEL_ID = "local-llama";
        const resolved = fakeResolved("primary");

        const picked = selectHealthyFallbackModel({} as AncientSettings, modelKey(resolved.provider, resolved.modelId));
        expect(picked).not.toBeNull();
        expect(picked?.resolved.modelId).toBe("local-llama");
        expect(picked?.isFree).toBe(true);
    } finally {
        if (prevBase === undefined) delete process.env.ANCIENT_FREE_MODEL_BASE_URL; else process.env.ANCIENT_FREE_MODEL_BASE_URL = prevBase;
        if (prevId === undefined) delete process.env.ANCIENT_FREE_MODEL_ID; else process.env.ANCIENT_FREE_MODEL_ID = prevId;
    }
});

test("selectHealthyFallbackModel returns null when every candidate is unavailable", () => {
    // Repo .env sets OPENAI_API_KEY, so the builtin default would resolve here;
    // clear it (with the free model) to prove the null path deterministically.
    const prevFreeBase = process.env.ANCIENT_FREE_MODEL_BASE_URL;
    const prevFreeId = process.env.ANCIENT_FREE_MODEL_ID;
    const prevKey = process.env.OPENAI_API_KEY;
    try {
        delete process.env.ANCIENT_FREE_MODEL_BASE_URL;
        delete process.env.ANCIENT_FREE_MODEL_ID;
        delete process.env.OPENAI_API_KEY;
        const resolved = fakeResolved("primary");
        const picked = selectHealthyFallbackModel({} as AncientSettings, modelKey(resolved.provider, resolved.modelId));
        expect(picked).toBeNull();
    } finally {
        if (prevFreeBase === undefined) delete process.env.ANCIENT_FREE_MODEL_BASE_URL; else process.env.ANCIENT_FREE_MODEL_BASE_URL = prevFreeBase;
        if (prevFreeId === undefined) delete process.env.ANCIENT_FREE_MODEL_ID; else process.env.ANCIENT_FREE_MODEL_ID = prevFreeId;
        if (prevKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevKey;
    }
});
