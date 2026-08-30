// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Layer 12 — Reliability & Resilience CONTRACT types (the *mechanisms* live
// in `packages/reliability`). `reliability` must stay a pure primitives
// library: it depends only on contracts and never imports the thing it
// protects (Layer 17 import rules).

import type { ErrorEnvelope } from "./error";
import type { ExecutionEvent } from "./execution";

/** Exponential-backoff budget (Layer 12 §4 / Layer 21 §4). */
export interface RetryBudget {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
  backoffMultiplier: number;
}

/** Circuit-breaker configuration (Layer 12 §9, Layer 21 §4). */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  windowMs: number;
  openDurationMs: number;
  halfOpenTrialRequests: number;
}

/** Bulkhead — one failing capability/provider must not consume all resources (Layer 12 §9). */
export interface Bulkhead {
  scope: "provider" | "tenant" | "capability_kind";
  maxConcurrent: number;
  circuitBreaker: CircuitBreakerConfig;
}

/** Backpressure policy (Layer 12 §8). */
export interface BackpressurePolicy {
  maxQueueDepth: number;
  onQueueFull: "reject_with_retry_after" | "shed_lowest_priority";
  perTenantConcurrencyLimit: number;
}

/** Timeout with an owner and a budget relationship to its parent (Layer 12 §2). */
export interface TimeoutPolicy {
  boundary: "model" | "tool" | "mcp" | "database" | "browser";
  timeoutMs: number;
  onTimeout: "fail" | "retry_once" | "escalate_to_execution_budget_check";
}

/** Shared cancellation chain (Layer 12 §3). */
export interface CancellationScope {
  signal: AbortSignal;
  /** Register a cleanup callback; always awaited on cancel. */
  onCancel(cleanup: () => Promise<void>): void;
}

/** Deliberate checkpoint (Layer 12 §6). */
export interface Checkpoint {
  executionId: string;
  sequence: number;
  stateSnapshot: unknown;
  /** capabilityId, if this checkpoint precedes a risky action. */
  createdBefore?: string;
}

/** Idempotent request — key MUST be derived from (executionId, stepId) (Layer 12 §5). */
export interface IdempotentRequest {
  idempotencyKey: string;
}

/** Recovery decision inputs (Layer 12 §7). */
export interface RecoveryPlan {
  lastCheckpoint: Checkpoint;
  eventsSinceCheckpoint: ExecutionEvent[];
  inFlightAtCrash: { capabilityId: string; idempotent: boolean }[];
  resumeAction: "replay_from_checkpoint" | "re_verify_then_resume" | "fail_needs_human";
}

/** Recorded effect of a capability run, for compensation (Layer 20 §5). */
export interface EffectRecord {
  capabilityId: string;
  executionId: string;
  input: unknown;
  occurredAt: string;
  verifiedState?: unknown;
}

/** Compensation counterpart for `reversible: true` capabilities (Layer 20 §5). */
export interface Compensation {
  forCapabilityId: string;
  compensate(effectRecord: EffectRecord): Promise<CompensationResult>;
}

export type CompensationResult =
  | { outcome: "compensated" }
  | { outcome: "compensation_failed"; error?: ErrorEnvelope }
  | { outcome: "not_needed" };