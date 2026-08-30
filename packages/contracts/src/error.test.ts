// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Contracts tests (contracts) — Layer 20 envelope defaults and the closed
// taxonomy helper behave as documented.

import { describe, expect, it } from "bun:test";
import { isTransientCode, makeError, type ErrorCode } from "./error";

describe("makeError", () => {
    it("fills occurredAt and attempt defaults", () => {
        const err = makeError({
            code: "PROVIDER_RATE_LIMITED",
            domain: "provider",
            message: "429 upstream",
            transient: true,
            retryableAsIs: true,
            partialEffect: "none",
            blastRadius: "step",
            traceId: "t-1",
        });
        expect(err.occurredAt).toBeDefined();
        expect(() => new Date(err.occurredAt).toISOString()).not.toThrow();
        expect(err.attempt).toBe(1);
    });

    it("defaults to fail-safe fields when omitted", () => {
        const err = makeError({
            code: "SYSTEM_UNKNOWN",
            domain: "engine",
            message: "unclassified",
            traceId: "t-2",
        });
        expect(err.transient).toBe(false);
        expect(err.retryableAsIs).toBe(false);
        expect(err.partialEffect).toBe("none");
        expect(err.blastRadius).toBe("execution");
    });

    it("honors an explicit attempt number", () => {
        const err = makeError({
            code: "MODEL_TIMEOUT",
            domain: "provider",
            message: "timed out",
            transient: true,
            retryableAsIs: true,
            partialEffect: "none",
            blastRadius: "step",
            traceId: "t-3",
            attempt: 3,
        });
        expect(err.attempt).toBe(3);
    });
});

describe("isTransientCode", () => {
    it("classifies transient families as transient", () => {
        const transient: ErrorCode[] = ["PROVIDER_RATE_LIMITED", "MODEL_TIMEOUT", "CAPABILITY_TIMEOUT", "EDGE_OVERLOADED", "INFRA_STORAGE_UNAVAILABLE"];
        for (const code of transient) {
            expect(isTransientCode(code)).toBe(true);
        }
    });

    it("classifies permanent failures as non-transient", () => {
        const permanent: ErrorCode[] = ["POLICY_DENIED", "AUTH_UNAUTHENTICATED", "CAPABILITY_INVALID_ARGUMENT", "STRATEGY_UNRECOVERABLE", "SYSTEM_UNKNOWN"];
        for (const code of permanent) {
            expect(isTransientCode(code)).toBe(false);
        }
    });
});