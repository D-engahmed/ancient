// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Reliability primitives tests (reliability) — retry/backoff, circuit breaker,
// and backpressure behaviors per Layer 12 / Layer 21 §4.

import { describe, expect, it } from "bun:test";
import { makeError, type ErrorEnvelope, type RetryBudget } from "@ANCIENT/contracts";
import { BackpressureGate, CircuitBreaker, nextDelay, withRetry } from "./index";

const budget: RetryBudget = { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 1000, jitter: false, backoffMultiplier: 2 };

const ratelimit = (): ErrorEnvelope =>
    makeError({
        code: "PROVIDER_RATE_LIMITED",
        domain: "provider",
        message: "429",
        transient: true,
        retryableAsIs: true,
        partialEffect: "none",
        blastRadius: "step",
        traceId: "t",
    });

describe("nextDelay", () => {
    it("grows exponentially and is capped at maxDelayMs", () => {
        expect(nextDelay(1, budget)).toBe(20); // 10 * 2^1
        expect(nextDelay(2, budget)).toBe(40); // 10 * 2^2
        const capped: RetryBudget = { ...budget, maxDelayMs: 32, baseDelayMs: 10 };
        expect(nextDelay(4, capped)).toBe(32);
    });

    it("applies 50–100% jitter when enabled", () => {
        const jittery: RetryBudget = { ...budget, jitter: true, baseDelayMs: 1000, maxDelayMs: 10000 };
        for (let i = 0; i < 50; i++) {
            const d = nextDelay(1, jittery);
            expect(d).toBeGreaterThanOrEqual(1000);
            expect(d).toBeLessThanOrEqual(2000);
        }
    });
});

describe("withRetry", () => {
    it("succeeds on the first attempt without retrying", async () => {
        let calls = 0;
        const result = await withRetry(async () => { calls++; return calls; }, budget, () => true);
        expect(result).toBe(1);
        expect(calls).toBe(1);
    });

    it("retries transient failures up to maxAttempts then throws", async () => {
        let calls = 0;
        const fail = async (): Promise<never> => { calls++; throw ratelimit(); };
        await expect(withRetry(fail, budget, () => true)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
        expect(calls).toBe(budget.maxAttempts);
    });

    it("does not retry when the predicate says no", async () => {
        let calls = 0;
        const fail = async (): Promise<never> => { calls++; throw ratelimit(); };
        await expect(withRetry(fail, budget, () => false)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
        expect(calls).toBe(1);
    });

    it("returns the value of the healing attempt", async () => {
        let calls = 0;
        const flaky = async () => {
            calls++;
            if (calls < 3) throw ratelimit();
            return "healed";
        };
        expect(await withRetry(flaky, budget, () => true)).toBe("healed");
        expect(calls).toBe(3);
    });
});

describe("CircuitBreaker", () => {
    it("starts closed and trips open past the threshold", () => {
        const cb = new CircuitBreaker({ failureThreshold: 3, windowMs: 1000, openDurationMs: 500, halfOpenTrialRequests: 1 });
        expect(cb.canProceed()).toBe(true);
        cb.onFailure(); cb.onFailure();
        expect(cb.canProceed()).toBe(true);
        cb.onFailure();
        expect(cb.canProceed()).toBe(false);
        expect(cb.getState()).toBe("open");
    });

    it("transitions open -> half_open and a trial success closes the breaker", () => {
        const cb = new CircuitBreaker({ failureThreshold: 1, windowMs: 1000, openDurationMs: 0, halfOpenTrialRequests: 1 });
        cb.onFailure();
        expect(cb.canProceed()).toBe(true); // openDuration 0 -> immediately half_open on first probe
        expect(cb.canProceed()).toBe(true); // half-open trial request #1 allowed
        expect(cb.canProceed()).toBe(false); // trial exhausted while still half_open
        cb.onSuccess();
        expect(cb.canProceed()).toBe(true);
        expect(cb.getState()).toBe("closed");
    });

    it("half-open trial failure reopens immediately", () => {
        const cb = new CircuitBreaker({ failureThreshold: 3, windowMs: 1000, openDurationMs: 0, halfOpenTrialRequests: 1 });
        cb.onFailure(); cb.onFailure(); cb.onFailure(); // open threshold reached
        cb.canProceed(); // -> half_open (openDuration 0 transitions on first probe)
        expect(cb.getState()).toBe("half_open");
        cb.onFailure(); // half-open failure
        expect(cb.getState()).toBe("open");
        cb.onFailure(); // still open: a second failure keeps it open, requires cooldown to trip back
        expect(cb.getState()).toBe("open");
    });

    it("success resets the rolling failure window", () => {
        const cb = new CircuitBreaker({ failureThreshold: 2, windowMs: 1000, openDurationMs: 500, halfOpenTrialRequests: 1 });
        cb.onFailure(); cb.onSuccess();
        cb.onFailure();
        expect(cb.getState()).toBe("closed"); // window was reset by the success
        expect(cb.canProceed()).toBe(true);
    });
});

describe("BackpressureGate", () => {
    it("runs jobs serially and returns results", async () => {
        const gate = new BackpressureGate({ maxQueueDepth: 2, onQueueFull: "reject_with_retry_after", perTenantConcurrencyLimit: 1 });
        const order: number[] = [];
        const r1 = gate.run(async () => { order.push(1); await new Promise((r) => setTimeout(r, 20)); });
        const r2 = gate.run(async () => { order.push(2); return 2; });
        const [a, b] = await Promise.all([r1, r2]);
        expect(a).toEqual({ ok: true, value: undefined });
        expect(b).toEqual({ ok: true, value: 2 });
        expect(order).toEqual([1, 2]);
    });

    it("rejects the overflow with an EDGE_OVERLOADED envelope", async () => {
        const gate = new BackpressureGate({ maxQueueDepth: 1, onQueueFull: "reject_with_retry_after", perTenantConcurrencyLimit: 1 });
        const slow = gate.run(async () => { await new Promise((r) => setTimeout(r, 50)); });
        const queued = gate.run(async () => 1);
        const overflow = gate.run(async () => 2, { priority: 9 });
        const results = await Promise.all([slow, queued, overflow]);
        expect(results[0]).toEqual({ ok: true, value: undefined });
        expect(results[1]).toEqual({ ok: true, value: 1 });
        expect(results[2]).toMatchObject({ ok: false, error: { code: "EDGE_OVERLOADED", transient: true } });
    });

    it("sheds the lowest-priority waiter when full", async () => {
        const gate = new BackpressureGate({ maxQueueDepth: 1, onQueueFull: "shed_lowest_priority", perTenantConcurrencyLimit: 1 });
        const slow = gate.run(async () => { await new Promise((r) => setTimeout(r, 50)); });
        const low = gate.run(async () => 1, { priority: 0 });
        const high = gate.run(async () => 2, { priority: 10 });
        const results = await Promise.all([slow, low, high]);
        expect(results[0]).toEqual({ ok: true, value: undefined });
        expect(results[1]).toMatchObject({ ok: false, error: { code: "EDGE_OVERLOADED" } });
        expect(results[2]).toEqual({ ok: true, value: 2 });
    });
});