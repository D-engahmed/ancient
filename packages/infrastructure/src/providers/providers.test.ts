// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { describe, expect, it } from "bun:test";
import { classifyPrompt, routeTurn } from "./router";
import type { ModelRoutingSettings } from "./routing-settings";
import { asFallbackCandidate, pickHealthyFallback } from "./fallback";
import { checkCooldown, isRateLimitError, modelKey, recordRateLimitFailure } from "./breaker";
import { costFor, pricingFor, sumCosts, type UsageTokens } from "./cost";
import { ProviderKeyCipher } from "./connection";

const ROUTING: ModelRoutingSettings = {
    enabled: true,
    strategy: "free-first",
    freeModel: { modelId: "gpt-free", baseUrl: "http://localhost:11434/v1" },
};

describe("classifyPrompt", () => {
    it("scores complex multi-file tasks high", () => {
        expect(classifyPrompt("refactor the auth module across the codebase", "BUILD")).toBeGreaterThanOrEqual(3);
    });
    it("scores trivial prompts low", () => {
        expect(classifyPrompt("rename this variable", "BUILD")).toBeLessThan(3);
    });
    it("bumps PLAN mode", () => {
        expect(classifyPrompt("tiny task", "PLAN")).toBeGreaterThan(classifyPrompt("tiny task", "BUILD"));
    });
});

describe("routeTurn", () => {
    it("routes simple prompts to the free lane", () => {
        expect(routeTurn("add a log here", "BUILD", ROUTING).lane).toBe("free");
    });
    it("keeps complex prompts on the selected model", () => {
        expect(routeTurn("refactor the auth module across the codebase", "BUILD", ROUTING).lane).toBe("selected");
    });
    it("keeps the selected lane when routing is disabled", () => {
        expect(routeTurn("add a log", "BUILD", { ...ROUTING, enabled: false }).lane).toBe("selected");
    });
});

describe("breaker + fallback", () => {
    it("derives a stable provider:model key", () => {
        expect(modelKey("openai", "gpt-5.6-sol")).toBe("openai:gpt-5.6-sol");
    });
    it("never picks the primary key as a fallback", () => {
        const primary = asFallbackCandidate("openai", "a", { ok: true }, false);
        const alt = asFallbackCandidate("openai", "b", { ok: true }, true);
        expect(pickHealthyFallback([primary, alt], primary.key)?.key).toBe(alt.key);
    });
    it("skips candidates currently on cooldown", () => {
        const cold = asFallbackCandidate("openai", "b", { ok: true }, true);
        recordRateLimitFailure(cold.key);
        expect(checkCooldown(cold.key).onCooldown).toBe(true);
        const healthy = asFallbackCandidate("openai", "c", { ok: true }, false);
        const primary = asFallbackCandidate("openai", "a", { ok: true }, false);
        expect(pickHealthyFallback([cold, healthy, primary], primary.key)?.key).toBe(healthy.key);
    });
    it("returns null when every candidate is unhealthy", () => {
        const primary = asFallbackCandidate("openai", "a", { ok: true }, false);
        const cold = asFallbackCandidate("openai", "b", { ok: true }, true);
        recordRateLimitFailure(cold.key);
        expect(pickHealthyFallback([cold], primary.key)).toBeNull();
    });
    it("detects rate-limit errors by status and phrase", () => {
        expect(isRateLimitError({ statusCode: 429 })).toBe(true);
        expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true);
        expect(isRateLimitError(new Error("boom"))).toBe(false);
        expect(isRateLimitError({ lastError: { statusCode: 429 } })).toBe(true);
    });
});

describe("cost", () => {
    it("returns undefined pricing for unknown model ids", () => {
        expect(pricingFor("definitely-not-a-model")).toBeUndefined();
    });
    it("computes a dollar cost from usage", () => {
        const usage: UsageTokens = { inputTokens: 2_000_000, outputTokens: 1_000_000 };
        const breakdown = costFor("gpt-4o", usage);
        // gpt-4o: $5/M input, $15/M output => 2*5 + 1*15 = $25
        expect(breakdown.totalUsd).toBeCloseTo(25);
    });
    it("sums multiple breakdowns", () => {
        const a = costFor("gpt-4o", { inputTokens: 1_000_000, outputTokens: 0 });
        const b = costFor("gpt-4o-mini", { inputTokens: 0, outputTokens: 1_000_000 });
        expect(sumCosts([a, b]).totalUsd).toBeCloseTo(5 + 0.6);
    });
});

describe("ProviderKeyCipher", () => {
    it("round-trips a key with AES-256-GCM", async () => {
        const secret = Buffer.alloc(32, 7).toString("base64");
        const cipher = new ProviderKeyCipher(secret);
        const encrypted = await cipher.encrypt("sk-test-abc123");
        expect(await cipher.decrypt(encrypted)).toBe("sk-test-abc123");
    });
    it("rejects non-32-byte secrets", () => {
        expect(() => new ProviderKeyCipher(Buffer.alloc(16, 1).toString("base64"))).toThrow(/32-byte/);
    });
});
