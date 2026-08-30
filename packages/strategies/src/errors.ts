// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Strategy error helpers (docs/04 §4.2 + Layer 20). Strategies only ever FAIL
// UPWARD as a typed ErrorEnvelope — never a raw exception, a `null`, or a
// swallowed console.error (docs/03 §3.2). Distinguishing "the model port threw
// a typed envelope" from "it threw something unclassified" is the one
// judgment call, and it lives HERE so every strategy classifies identically.

import { makeError, type ErrorCode, type ErrorDomain, type ErrorEnvelope } from "@ANCIENT/contracts";

/** True when the thrown value is already a canonical ErrorEnvelope. */
export function isEnvelope(err: unknown): err is ErrorEnvelope {
    return (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: unknown }).code !== undefined &&
        (err as { domain?: unknown }).domain !== undefined
    );
}

/**
 * Normalize a thrown value into an envelope.
 * - A typed envelope passes through unchanged (classification preserved).
 * - Anything else becomes the given fallback — deliberately conservative
 *   (Layer 20: an unclassified failure is NOT silently treated as transient).
 */
export function asEnvelope(
    err: unknown,
    fallback: { code: ErrorCode; domain: ErrorDomain; message: string },
): ErrorEnvelope {
    if (isEnvelope(err)) return err;
    return makeError({ code: fallback.code, domain: fallback.domain, message: fallback.message });
}