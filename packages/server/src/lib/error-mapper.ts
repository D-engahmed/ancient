// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Gateway Error Mapper (docs/02 Sub-layer F + docs/20 §6).
//
// The ONE serializer for every client-visible error. Downstream failures
// (engine/strategy/capability/provider) arrive as canonical ErrorEnvelopes
// (Layer 20); this module:
//
//   1. strips internal detail not safe for the caller (clientMessage ?? message),
//   2. attaches a stable closed ErrorCode the client can branch on,
//   3. attaches retryability (+ retryAfterMs when the caller should wait),
//   4. attaches a traceId, always, so a support engineer can find the full
//      internal error chain without the client ever seeing stack traces or
//      provider names.
//
// A plain Error (no envelope) is classified conservatively as SYSTEM_UNKNOWN
// and logged — the taxonomy is closed, so we never mint ad-hoc codes here;
// adding one requires an ADR (Layer 20 §2). The output shape is exactly the
// SSE wire's errorEnvelopeSchema (ClientSafeError) wrapped in { error }, so
// HTTP edges and the execution stream share one body shape for the CLI.

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorCode, ErrorEnvelope } from "@ANCIENT/contracts";
import type { ClientSafeError } from "@ANCIENT/shared";
import { RateLimitCooldownError } from "./rate-limit-breaker";
import { ProviderConnectionValidationError } from "./provider-connection-validation";

/** The wire shape every error response body spells (docs/02 §F). */
export type GatewayErrorResponse = { error: ClientSafeError };

/** Is this a canonical ErrorEnvelope? (duck-typed; strategies share the codes) */
function isEnvelope(err: unknown): err is ErrorEnvelope {
    return (
        typeof err === "object" &&
        err !== null &&
        typeof (err as { code?: unknown }).code === "string" &&
        typeof (err as { message?: unknown }).message === "string" &&
        typeof (err as { transient?: unknown }).transient === "boolean" &&
        typeof (err as { traceId?: unknown }).traceId === "string"
    );
}

/** Non-leaky per-family default summaries (docs/20 §6 genericMessageFor). */
const GENERIC_MESSAGES: Partial<Record<ErrorCode, string>> = {
    EDGE_RATE_LIMITED: "You are being rate limited. Slow down and retry shortly.",
    EDGE_OVERLOADED: "The service is busy right now. Retry shortly.",
    EDGE_PAYLOAD_TOO_LARGE: "The request is too large. Reduce its size and retry.",
    EDGE_ABUSE_SIGNATURE: "The request was rejected. If you believe this is a mistake, contact the administrator.",
    AUTH_UNAUTHENTICATED: "Authentication is required. Please log in again.",
    AUTH_TOKEN_EXPIRED: "Your session expired. Please log in again.",
    AUTH_INSUFFICIENT_SCOPE: "You do not have permission to do that.",
    POLICY_DENIED: "The request was denied by policy. Adjust the task and try again.",
    POLICY_APPROVAL_REQUIRED: "This action requires explicit approval.",
    CONTEXT_BUDGET_EXCEEDED: "The task is too large for the context budget.",
    CONTEXT_SOURCE_UNAVAILABLE: "A context source was unavailable; the task ran with less context.",
    MODEL_TIMEOUT: "The model took too long to respond. Retry.",
    MODEL_INVALID_OUTPUT: "The model produced an unusable response. Retry.",
    MODEL_CONTEXT_OVERFLOW: "The model's context overflowed. Shorten the task and retry.",
    MODEL_CONTENT_FILTERED: "The model refused to answer.",
    PROVIDER_RATE_LIMITED: "The model provider is rate-limiting requests. Wait and retry.",
    PROVIDER_UNAVAILABLE: "The model provider is unavailable right now. Retry.",
    PROVIDER_AUTH_FAILED: "The provider rejected the API key. Reconnect or rotate your key.",
    PROVIDER_UNSUPPORTED_CAPABILITY: "The selected model does not support the required capability.",
    CAPABILITY_TIMEOUT: "A capability timed out.",
    CAPABILITY_INVALID_ARGUMENT: "The action received invalid arguments.",
    CAPABILITY_EXECUTION_FAILED: "The action failed to execute.",
    CAPABILITY_SANDBOX_LOST: "The sandbox the action ran in is no longer reachable.",
    CAPABILITY_PARTIAL_EFFECT: "The action may have had a partial effect. Verify before continuing.",
    STRATEGY_BUDGET_EXCEEDED: "The strategy exceeded its budget.",
    STRATEGY_STALLED: "The strategy stalled and could not make progress.",
    STRATEGY_UNRECOVERABLE: "The strategy could not recover. Refine the task and retry.",
    INFRA_STORAGE_UNAVAILABLE: "A storage dependency is unavailable.",
    INFRA_EVENT_LOG_WRITE_FAILED: "The event log could not be written.",
    INFRA_SECRETS_UNAVAILABLE: "The secrets store is unavailable.",
    CONFLICT_VERSION_MISMATCH: "The resource changed since it was read. Reload and retry.",
    CONFLICT_DUPLICATE_IDEMPOTENCY_KEY: "A request with this idempotency key was already processed.",
    SYSTEM_UNKNOWN: "Something went wrong on our side. Please retry or check the trace id.",
};

/** §6 genericMessageFor — the reviewed lookup, never derived from internals. */
export function genericMessageFor(code: ErrorCode): string {
    return GENERIC_MESSAGES[code] ?? GENERIC_MESSAGES.SYSTEM_UNKNOWN!;
}

/** HTTP status implied by an ErrorCode (Layer 2 edge conventions). */
export function statusForCode(code: ErrorCode, fallback = 500): number {
    switch (code) {
        case "EDGE_RATE_LIMITED":
        case "PROVIDER_RATE_LIMITED":
            return 429;
        case "EDGE_OVERLOADED":
        case "PROVIDER_UNAVAILABLE":
        case "CONTEXT_SOURCE_UNAVAILABLE":
        case "INFRA_STORAGE_UNAVAILABLE":
        case "INFRA_EVENT_LOG_WRITE_FAILED":
        case "INFRA_SECRETS_UNAVAILABLE":
            return 503;
        case "EDGE_PAYLOAD_TOO_LARGE":
            return 413;
        case "EDGE_ABUSE_SIGNATURE":
        case "POLICY_DENIED":
            return 403;
        case "AUTH_UNAUTHENTICATED":
        case "AUTH_TOKEN_EXPIRED":
        case "PROVIDER_AUTH_FAILED":
            return 401;
        case "AUTH_INSUFFICIENT_SCOPE":
        case "POLICY_APPROVAL_REQUIRED":
            return 403;
        case "CAPABILITY_INVALID_ARGUMENT":
            return 422;
        case "MODEL_TIMEOUT":
        case "CAPABILITY_TIMEOUT":
            return 504;
        case "CONFLICT_VERSION_MISMATCH":
        case "CONFLICT_DUPLICATE_IDEMPOTENCY_KEY":
            return 409;
        default:
            return fallback;
    }
}

/**
 * Normalize whatever a route caught into the client-safe envelope + an
 * HTTP status. Recognizes canonical ErrorEnvelopes (SSE path), the server's
 * own custom error classes, rate-limit-shaped errors, and plain Errors.
 */
export function clientErrorFrom(err: unknown, traceId: string): { response: ClientSafeError; status: number } {
    if (err instanceof RateLimitCooldownError) {
        return {
            response: {
                code: "EDGE_RATE_LIMITED",
                message: err.message,
                retryable: true,
                retryAfterMs: err.retryAfterSeconds * 1000,
                traceId,
            },
            status: 429,
        };
    }

    if (err instanceof ProviderConnectionValidationError) {
        return {
            response: {
                code: "PROVIDER_AUTH_FAILED",
                message: err.message || "Unsupported provider connection",
                retryable: false,
                traceId,
            },
            status: 422,
        };
    }

    if (isEnvelope(err)) {
        return {
            response: {
                code: err.code,
                message: err.clientMessage ?? err.message,
                retryable: err.transient,
                traceId: err.traceId,
            },
            status: statusForCode(err.code),
        };
    }

    // An unclassified failure is SYSTEM_UNKNOWN — logged loudly downstream,
    // surfaced with the generic message here (Layer 20 last-resort code).
    return {
        response: {
            code: "SYSTEM_UNKNOWN",
            message: genericMessageFor("SYSTEM_UNKNOWN"),
            retryable: false,
            traceId,
        },
        status: 500,
    };
}

/**
 * Non-classified gateway GUARD error (unrecognised resource, unsupported
 * verb, stale session): a stable HTTP status with the traceId attached and a
 * SYSTEM_UNKNOWN code until Layer 10 ADRs add gateway codes for these.
 */
export function gatewayError(message: string, status: number, traceId: string): GatewayErrorResponse {
    return {
        error: {
            code: "SYSTEM_UNKNOWN",
            message,
            retryable: status >= 500,
            traceId,
        },
    };
}

/**
 * Hono convenience: build a full error Response with the trace header set.
 * `status` overrides the code-derived status (guards pass it explicitly).
 * `Context<any>` keeps this usable from any route env (any Variables shape).
 */
export function errorJson(c: Context<any>, err: unknown, status?: number): Response {
    const traceId = String(c.get("traceId"));
    const { response, status: derived } = clientErrorFrom(err, traceId);
    c.header("X-Trace-Id", traceId);
    return c.json({ error: response }, (status ?? derived) as ContentfulStatusCode);
}

/** Hono convenience for guard errors (404/409/...): body + trace header. */
export function guardJson(c: Context<any>, message: string, status: number): Response {
    const traceId = String(c.get("traceId"));
    c.header("X-Trace-Id", traceId);
    return c.json(gatewayError(message, status, traceId), status as ContentfulStatusCode);
}