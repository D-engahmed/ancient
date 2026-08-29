// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Canonical contracts package (Layer 17 — contracts is the stable, dependency-free
// base of the whole monorepo). Layer 20 (Error) and Layer 21 §4 (drop-in code).

export {
  makeError,
  isTransientCode,
  ERROR_CODES,
  type ErrorDomain,
  type ErrorCode,
  type ErrorEnvelope,
  type ErrorEnvelopeInput,
  type PartialEffect,
  type BlastRadius,
} from "./error";

export {
  type ExecutionStatus,
  type ExecutionRequest,
  type StrategySelection,
  type Execution,
  type TokenUsage,
  type ExecutionEvent,
  type ExecutionEventName,
  TERMINAL_EXECUTION_EVENTS,
  CLI_V2_EXECUTION_STATUSES,
} from "./execution";

export {
  type CapabilityKind,
  type CapabilityErrorClass,
  type CostModel,
  type Capability,
  type CapabilityError,
} from "./capability";

export {
  type StrategyFailurePolicy,
  type AgentLoopFailurePolicy,
  type SubagentResult,
  type StrategyContext,
  type CapabilityPolicy,
  type ExecutionBudget,
  type StrategyRunContract,
  type Strategy,
  type StrategyExecution,
} from "./strategy";

export {
  type ModelCapability,
  type AuthMode,
  type ModelDescriptor,
  type ProviderHealth,
  type ModelProviderPlugin,
  type CompletionRequest,
  type CanonicalMessage,
  type CompletionEvent,
  type ModelPolicy,
} from "./model";

export {
  type RetryBudget,
  type CircuitBreakerConfig,
  type Bulkhead,
  type BackpressurePolicy,
  type TimeoutPolicy,
  type CancellationScope,
  type Checkpoint,
  type IdempotentRequest,
  type RecoveryPlan,
  type EffectRecord,
  type Compensation,
  type CompensationResult,
} from "./reliability";