// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Layer 20 — Error and Failure Model. The CANONICAL error shape.
// No other layer may invent its own error envelope; every failure in the
// system (edge, auth, gateway, engine, strategy, capability, provider,
// infrastructure) is represented by this one shape + closed taxonomy.

/** Which layer the failure originated from. */
export type ErrorDomain =
  | "edge"
  | "auth"
  | "gateway"
  | "engine"
  | "strategy"
  | "capability"
  | "provider"
  | "infrastructure"
  | "policy";

/**
 * Closed `ErrorCode` taxonomy (Layer 20 §2). Adding a code requires an ADR,
 * not an ad-hoc string in a `catch` block. `SYSTEM_UNKNOWN` is intentional —
 * it is the last resort, and its rate must be tracked and alerted on.
 */
export type ErrorCode =
  // EDGE: rejected at the boundary; no retry by the server.
  | "EDGE_RATE_LIMITED"
  | "EDGE_OVERLOADED"
  | "EDGE_PAYLOAD_TOO_LARGE"
  | "EDGE_ABUSE_SIGNATURE"
  // AUTH: fail immediately, surface to client.
  | "AUTH_UNAUTHENTICATED"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_INSUFFICIENT_SCOPE"
  // POLICY: expected outcome, not an incident.
  | "POLICY_DENIED"
  | "POLICY_APPROVAL_REQUIRED"
  // CONTEXT: degrade (Layer 12.10), continue execution.
  | "CONTEXT_BUDGET_EXCEEDED"
  | "CONTEXT_SOURCE_UNAVAILABLE"
  // MODEL: model-level failures.
  | "MODEL_TIMEOUT"
  | "MODEL_INVALID_OUTPUT"
  | "MODEL_CONTEXT_OVERFLOW"
  | "MODEL_CONTENT_FILTERED"
  // PROVIDER: provider-level failures (any vendor, incl. BYOK/free keys).
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_UNSUPPORTED_CAPABILITY"
  // CAPABILITY: capability-level failures (Layer 5).
  | "CAPABILITY_TIMEOUT"
  | "CAPABILITY_INVALID_ARGUMENT"
  | "CAPABILITY_EXECUTION_FAILED"
  | "CAPABILITY_SANDBOX_LOST"
  | "CAPABILITY_PARTIAL_EFFECT"
  // STRATEGY: strategy-level failures (Layer 4).
  | "STRATEGY_BUDGET_EXCEEDED"
  | "STRATEGY_STALLED"
  | "STRATEGY_UNRECOVERABLE"
  // INFRA: infrastructure failures.
  | "INFRA_STORAGE_UNAVAILABLE"
  | "INFRA_EVENT_LOG_WRITE_FAILED"
  | "INFRA_SECRETS_UNAVAILABLE"
  // CONFLICT: state conflicts.
  | "CONFLICT_VERSION_MISMATCH"
  | "CONFLICT_DUPLICATE_IDEMPOTENCY_KEY"
  // SYSTEM: last resort; every occurrence is a bug ticket, not steady-state.
  | "SYSTEM_UNKNOWN";

/**
 * Runtime mirror of the `ErrorCode` union, so the wire layer can build a
 * `z.enum(ERROR_CODES)` validator from one source instead of duplicating the
 * taxonomy strings. Keep this exhaustive (the union is the compile-time guard).
 */
export const ERROR_CODES: readonly ErrorCode[] = [
  "EDGE_RATE_LIMITED",
  "EDGE_OVERLOADED",
  "EDGE_PAYLOAD_TOO_LARGE",
  "EDGE_ABUSE_SIGNATURE",
  "AUTH_UNAUTHENTICATED",
  "AUTH_TOKEN_EXPIRED",
  "AUTH_INSUFFICIENT_SCOPE",
  "POLICY_DENIED",
  "POLICY_APPROVAL_REQUIRED",
  "CONTEXT_BUDGET_EXCEEDED",
  "CONTEXT_SOURCE_UNAVAILABLE",
  "MODEL_TIMEOUT",
  "MODEL_INVALID_OUTPUT",
  "MODEL_CONTEXT_OVERFLOW",
  "MODEL_CONTENT_FILTERED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_AUTH_FAILED",
  "PROVIDER_UNSUPPORTED_CAPABILITY",
  "CAPABILITY_TIMEOUT",
  "CAPABILITY_INVALID_ARGUMENT",
  "CAPABILITY_EXECUTION_FAILED",
  "CAPABILITY_SANDBOX_LOST",
  "CAPABILITY_PARTIAL_EFFECT",
  "STRATEGY_BUDGET_EXCEEDED",
  "STRATEGY_STALLED",
  "STRATEGY_UNRECOVERABLE",
  "INFRA_STORAGE_UNAVAILABLE",
  "INFRA_EVENT_LOG_WRITE_FAILED",
  "INFRA_SECRETS_UNAVAILABLE",
  "CONFLICT_VERSION_MISMATCH",
  "CONFLICT_DUPLICATE_IDEMPOTENCY_KEY",
  "SYSTEM_UNKNOWN",
] as const;

/** Did a side effect occur before the failure? Drives retry vs. compensation. */
export type PartialEffect = "none" | "unknown" | "occurred";

/** How far a failure is allowed to propagate (Layer 20 §4). */
export type BlastRadius = "step" | "strategy" | "execution" | "tenant" | "platform";

/**
 * The canonical error envelope (Layer 20 §1). Versioned contract
 * (ErrorEnvelope.v1); additive fields allowed in minor versions only.
 */
export interface ErrorEnvelope {
  /** Closed taxonomy code (Layer 20 §2). */
  code: ErrorCode;
  /** Which layer originated it. */
  domain: ErrorDomain;
  /** Internal message; may contain detail. Never shown raw to a client. */
  message: string;
  /** Safe-for-client summary, set by the Gateway (Layer 20 §6). */
  clientMessage?: string;
  /** Expected to succeed if retried unchanged? */
  transient: boolean;
  /** True only if the failing operation is idempotent (Layer 20 decision table). */
  retryableAsIs: boolean;
  /** Did a side effect happen before failure? */
  partialEffect: PartialEffect;
  /** Blast radius; must never escalate silently (Layer 20 §4). */
  blastRadius: BlastRadius;
  executionId?: string;
  stepId?: string;
  capabilityId?: string;
  providerId?: string;
  /** Always present; the thread through Layer 7 observability. */
  traceId: string;
  /** ISO 8601. */
  occurredAt: string;
  /** 1-indexed; which retry attempt produced this. */
  attempt: number;
  /** Chained cause, for wrapped errors. */
  cause?: ErrorEnvelope;
  /** Original error object. Log-only, scrubbed of secrets; NEVER serialized to a client response. */
  raw?: unknown;
}

/** Helper shape: everything required except the auto-filled fields. */
export type ErrorEnvelopeInput = Omit<
  ErrorEnvelope,
  | "occurredAt"
  | "attempt"
  | "traceId"
  | "transient"
  | "retryableAsIs"
  | "partialEffect"
  | "blastRadius"
> & {
  /** Defaults to `1`. */
  attempt?: number;
  /** Defaults to a freshly generated id. */
  traceId?: string;
  /** Defaults to `false`; override only when the failure is transient. */
  transient?: boolean;
  /** Defaults to `false`; override only when the failing operation is idempotent. */
  retryableAsIs?: boolean;
  /** Defaults to `'none'`. */
  partialEffect?: PartialEffect;
  /** Defaults to `'execution'`. */
  blastRadius?: BlastRadius;
};

/** RFC4122-free random id (works on Node/Bun/edge). Fallback for non-crypto runtimes. */
function newTraceId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Build a canonical envelope with sensible auto-filled fields (Layer 21 §4).
 * Defaults: `transient: false`, `retryableAsIs: false`,
 * `partialEffect: 'none'`, `blastRadius: 'execution'`, `attempt: 1`.
 */
export function makeError(partial: ErrorEnvelopeInput): ErrorEnvelope {
  const { attempt, traceId, ...rest } = partial;
  return {
    ...rest,
    traceId: traceId ?? newTraceId(),
    transient: rest.transient ?? false,
    retryableAsIs: rest.retryableAsIs ?? false,
    partialEffect: rest.partialEffect ?? ("none" as const),
    blastRadius: rest.blastRadius ?? ("execution" as const),
    attempt: attempt ?? 1,
    occurredAt: new Date().toISOString(),
  };
}

/**
 * Default transient/retry classification per code family (Layer 20 §3).
 * Used by layers to avoid re-deriving the decision table per call site.
 */
export function isTransientCode(code: ErrorCode): boolean {
  switch (code) {
    case "EDGE_RATE_LIMITED":
    case "EDGE_OVERLOADED":
    case "CONTEXT_BUDGET_EXCEEDED":
    case "CONTEXT_SOURCE_UNAVAILABLE":
    case "MODEL_TIMEOUT":
    case "MODEL_INVALID_OUTPUT":
    case "PROVIDER_RATE_LIMITED":
    case "PROVIDER_UNAVAILABLE":
    case "CAPABILITY_TIMEOUT":
    case "INFRA_STORAGE_UNAVAILABLE":
    case "INFRA_EVENT_LOG_WRITE_FAILED":
    case "INFRA_SECRETS_UNAVAILABLE":
      return true;
    default:
      return false;
  }
}