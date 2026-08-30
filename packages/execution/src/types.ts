// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Engine contract (engine) — the unified execution engine (ARCHITECTURE.md §4).
//
// The engine turns a plain task into an execution: infer a TaskProfile, ask the
// strategy selector for the cheapest wired strategy (A-STRAT-001), and drive its
// event stream through a StrategyRuntime the engine implements over the capability
// registry + a model chat port. It owns lifecycle, cancellation, and observability;
// durable checkpointing (A-EXEC-003) is the infrastructure storage layer's contract
// and is wired by the gateway later, not here.

import type { ConsentProvider, ExecutionScope } from "@ANCIENT/capabilities/core";
import type { ApprovalPolicy, Redactor } from "@ANCIENT/infrastructure/security";
import type { EventBus, LifecycleEventType } from "@ANCIENT/infrastructure/events";
import type { RetryBudget } from "@ANCIENT/contracts";
import type {
    ErrorEnvelope,
} from "@ANCIENT/contracts";
import type {
    ModelTurnResult,
    StrategyEvent,
    StrategySelection,
    TaskProfile,
    TurnMessage,
} from "@ANCIENT/strategies";
import type { ModeType } from "@ANCIENT/shared";

export type { TaskProfile, StrategyEvent, StrategySelection };
export type { ErrorEnvelope, RetryBudget };

/** Context block slots the engine layers into the system prompt (A-ENG-002). */
export type ContextBlock = "memory" | "skills" | "agents" | "mcp" | "session";

/**
 * Engine-owned context for a run (A-ENG-002). Blocks arrive pre-rendered from
 * their owning layers (infrastructure/memory, capabilities/skills, gateway
 * hooks); the engine applies per-block token caps, layers them, and trims
 * history at the runModel port.
 */
export type EngineContextOptions = {
    blocks?: Partial<Record<ContextBlock, string>>;
    /** Per-block token caps; override the defaults in context.ts. */
    budgets?: Partial<Record<ContextBlock, number>>;
    /** Token cap for the whole assembled system prompt. */
    systemBudget?: number;
    /** Token cap for the whole conversation history at runModel. */
    historyBudget?: number;
};

/**
 * The model chat port the engine drives strategies over. A concrete adapter
 * (e.g. `createAiModelChat` in model.ts) speaks to a provider; tests script it.
 * The single call shape mirrors `StrategyRuntime.runModel`.
 */
export type ModelChat = (input: {
    system?: string;
    prompt?: string;
    history?: TurnMessage[];
    tools?: { name: string; description: string; inputSchema: unknown }[];
}) => Promise<ModelTurnResult>;

/**
 * Lifecycle status (docs/03 §state diagram). The engine only ever transitions
 * along documented edges and is the SOLE writer of terminal status
 * (`completed|failed|cancelled`) — strategies/capabilities report failures
 * upward as ErrorEnvelopes and never set terminal state themselves (§3.1).
 * The transitional states (`queued`, `waiting_approval`, `paused`,
 * `checkpointed`) are representable for the durable projection the moment an
 * orchestrator drives them; the live gateway surface collapses to the classic
 * five for now.
 */
export type ExecutionStatus =
    | "created"
    | "queued"
    | "running"
    | "waiting_approval"
    | "paused"
    | "checkpointed"
    | "completed"
    | "failed"
    | "cancelled";

/** What the caller asks the engine to do. */
export type RunRequest = {
    /** Stable id for the session; defaults to a fresh randomUUID. Lets the
     *  gateway correlate bridge events before the engine emits them. */
    sessionId?: string;
    /** The task prompt/description (already user-supplied). */
    task: string;
    /** Per-execution context handed to every tool executor. */
    scope: ExecutionScope;
    /** Approval boundary for every tool call (config, not per-tool). */
    policy: ApprovalPolicy;
    /** Model chat port — real providers come from the gateway. */
    model: ModelChat;
    /** Execution mode; gates which tools the registry exposes. */
    mode?: ModeType;
    /** Tool allow-list (subset of the registry to expose). */
    allow?: readonly string[];
    /** Explicit TaskProfile hints; these override profiler inference. */
    profile?: Partial<TaskProfile>;
    /** Engine-owned context for the run (A-ENG-002). Blocks arrive pre-rendered
     *  from their owning layers; the engine budgets, layers, and trims them. */
    context?: EngineContextOptions;
    /** Live observer of strategy events (CLI-V2 gateway bridging). Called once
     *  per strategy event, in stream order, alongside `session.record`. */
    observe?: (event: StrategyEvent) => void;
    /** Retry budget for TRANSIENT strategy-level failures (docs/03: Failed →
     *  Queued only when classified retryable). Non-transient errors are always
     *  terminal; the engine never blindly retries (Layer 20 §3). */
    retryBudget?: RetryBudget;
    /** Consent flow for `require-consent` approvals (default: deny). */
    consentProvider?: ConsentProvider;
    /** Secret redactor applied at the central tool edge. */
    redactor?: Redactor;
    /** Lifecycle bus; defaults to the engine's own. */
    bus?: EventBus;
};

/** Rollup after a run settles. */
export type RunResult = {
    sessionId: string;
    status: RunStatus;
    strategy: StrategySelection;
    turnCount: number;
    toolCount: number;
    usage: { inputTokens: number; outputTokens: number };
    /** How many times a transient failure caused the strategy to re-run. */
    retryCount: number;
    /** Concatenated model text across turns (may be empty). */
    output?: string;
    /** Strategy `done` summary, when provided. */
    summary?: string;
    /** First error message, when the run failed/was cancelled. */
    error?: string;
    /** Typed terminal failure (Layer 20 §1), when the run failed. */
    lastError?: ErrorEnvelope;
};

export type RunStatus = "completed" | "failed" | "cancelled";

/**
 * A live execution: recorded strategy events (replay), cancellation, and the
 * lifecycle bus publication. This is the "hot runtime state" of A-EXEC-003 —
 * a derivation of the lifecycle events, not a source of truth.
 */
export type ExecutionSession = {
    id: string;
    status: ExecutionStatus;
    /** Events published onto the engine bus as the run progresses. */
    publish(type: LifecycleEventType, payload?: Record<string, unknown>): void;
    /** Record a strategy event for this session (replay). */
    record(event: StrategyEvent): void;
    /** Snapshot of recorded strategy events so far. */
    events(): readonly StrategyEvent[];
    /** Request cancellation — the run loop stops consuming the stream. */
    cancel(reason?: string): void;
    readonly cancelled: boolean;
    /** Resolves when the run settles (completed/failed/cancelled). */
    readonly done: Promise<RunResult>;
};