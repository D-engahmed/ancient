import { describe, expect, it } from "bun:test";
import { CostCeilingExceededError, CostLedger, parseCeilingUsd } from "./cost-ledger";
import { clientErrorFrom } from "./error-mapper";

describe("parseCeilingUsd", () => {
    it("is unlimited when the env var is absent or empty", () => {
        expect(parseCeilingUsd(undefined)).toBeNull();
        expect(parseCeilingUsd("")).toBeNull();
        expect(parseCeilingUsd("   ")).toBeNull();
    });

    it("parses a positive decimal", () => {
        expect(parseCeilingUsd("12.50")).toBe(12.5);
        expect(parseCeilingUsd("0")).toBe(0);
    });

    it("ignores garbage", () => {
        expect(parseCeilingUsd("-5")).toBeNull();
        expect(parseCeilingUsd("abc")).toBeNull();
        expect(parseCeilingUsd("NaN")).toBeNull();
    });
});

describe("CostLedger", () => {
    it("is unlimited and within ceiling by default", () => {
        const ledger = new CostLedger();
        const snap = ledger.snapshot();
        expect(snap.active).toBe(false);
        expect(snap.over).toBe(false);
        expect(ledger.withinCeiling()).toBe(true);
    });

    it("tracks spend for catalog-priced models", () => {
        const ledger = new CostLedger({ ceilingUsd: 100 });
        // gpt-4o: $5/1M input, $15/1M output → 1M/0.5M = $5 + $7.5 = $12.5
        const cost = ledger.record("gpt-4o", { inputTokens: 1_000_000, outputTokens: 500_000 });
        expect(cost).toBeCloseTo(12.5);
        expect(ledger.spendUsd()).toBeCloseTo(12.5);
        expect(ledger.withinCeiling()).toBe(true);
    });

    it("blocks once spend meets the ceiling", () => {
        const ledger = new CostLedger({ ceilingUsd: 12.5 });
        ledger.record("gpt-4o", { inputTokens: 1_000_000, outputTokens: 500_000 });
        expect(ledger.withinCeiling()).toBe(false);
        const snap = ledger.snapshot();
        expect(snap.over).toBe(true);
        expect(snap.active).toBe(true);
    });

    it("counts only platform-billed calls (caller decides)", () => {
        const ledger = new CostLedger({ ceilingUsd: 10 });
        // Unpriced local model records 0 and never hits the ceiling.
        ledger.record("ollama-default", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
        expect(ledger.spendUsd()).toBe(0);
        expect(ledger.withinCeiling()).toBe(true);
    });

    it("exposes a typed ceiling error for start-gate rejection", () => {
        const err = new CostCeilingExceededError(5, 5, "trace-1");
        expect(err.envelope.code).toBe("BILLING_COST_CEILING_EXCEEDED");
        expect(err.envelope.transient).toBe(false);
        expect(err.envelope.traceId).toBe("trace-1");
    });

    it("maps to a 403 client-safe error on the HTTP edge", () => {
        const { response, status } = clientErrorFrom(new CostCeilingExceededError(5, 5, "trace-1"), "trace-1");
        expect(status).toBe(403);
        expect(response.code).toBe("BILLING_COST_CEILING_EXCEEDED");
        expect(response.retryable).toBe(false);
        expect(response.message).toContain("cost ceiling");
    });
});