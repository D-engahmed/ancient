// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Layer 4 — Execution Strategy contract. Strategies define HOW work is done
// and how it fails explicitly. `StrategyFailurePolicy` is the shared shape
// that Layer 4 and Layer 20 agree on — never migrate the happy path without
// the failure policy attached.

import type { ErrorEnvelope } from "./error";
import type { ExecutionRequest } from "./execution";
import type { Capability } from "./capability";
import type { ModelPolicy } from "./model";

/** Shared failure policy every strategy carries (Layer 4, Layer 20). */
export interface StrategyFailurePolicy {
  /** Bounded consecutive failures before the strategy escalates (e.g. 3). */
  maxConsecutiveFailures: number;
  /** Bounded total failures across the run (e.g. 8). */
  maxTotalFailures: number;
  /** What to do when the execution budget is exceeded. */
  onBudgetExceeded: "fail" | "checkpoint_and_pause";
}

/** Agent-loop-specific failure policy (Layer 4.2). */
export interface AgentLoopFailurePolicy extends StrategyFailurePolicy {
  /** Max consecutive failed tool calls at the loop level. */
  maxConsecutiveFailures: number;
  /** Max total failures across the whole run. */
  maxTotalFailures: number;
  onBudgetExceeded: "fail" | "checkpoint_and_pause";
}

/** Typed subagent result — explicitly success/partial/failed (Layer 4.3). */
export interface SubagentResult {
  subagentId: string;
  outcome: "success" | "partial" | "failed";
  output?: unknown;
  error?: ErrorEnvelope;
}

/**
 * What every strategy receives at execution time (Layer 4 "Common strategy
 * services"). The engine implements this port; strategies never import it.
 */
export interface StrategyContext {
  executionId: string;
  /** Opaque context handle (owned by the context manager, Layer 3.3). */
  context: unknown;
  modelPolicy: ModelPolicy;
  /** Capability access policy governing every `Capability` call. */
  capabilityPolicy: CapabilityPolicy;
  /** Execution budget; child timeouts must be strictly shorter. */
  budget: ExecutionBudget;
  /** Shared cancellation chain (Layer 12 §3). */
  cancellation: AbortSignal;
  /** Shared failure shape (Layer 4 / Layer 20). */
  failurePolicy: StrategyFailurePolicy;
  request: ExecutionRequest;
}

/** Capability access policy — enforced by the Policy Engine (Layer 5), not prompting. */
export interface CapabilityPolicy {
  allowedCapabilityIds: string[];
  denyDeniedToolRetry?: boolean;
}

/** Execution budget windows (Layer 12 §2). */
export interface ExecutionBudget {
  /** Total execution budget in ms. */
  totalMs: number;
  /** Per-step budget in ms, strictly shorter than remaining total. */
  stepMs: number;
  /** Optional max model calls. */
  maxModelCalls?: number;
  /** Optional max tool calls. */
  maxToolCalls?: number;
}

/** What a strategy emits after running (the caller consumes the stream). */
export interface StrategyRunContract {
  /** Model observations to surface. */
  onModelRequested?: (input: unknown) => void;
  /** Capability invocations observed. */
  onCapability?: (capability: Capability) => void;
}

/** Signature of a strategy implementation (the engine's Strategy port). */
export interface Strategy {
  id: string;
  label: string;
  complexity: 0 | 1 | 2 | 3 | 4;
  execute(ctx: StrategyContext): Promise<StrategyExecution>;
}

/** Result of one strategy execution. */
export interface StrategyExecution {
  outcome: "completed" | "degraded" | "failed";
  output?: unknown;
  error?: ErrorEnvelope;
}