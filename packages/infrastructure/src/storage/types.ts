// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Durable execution-store types (infrastructure).
//
// Per docs/architecture/EXECUTION-STATE.md (assumption A-EXEC-003), the durable
// truth for an execution is an APPEND-ONLY lifecycle event stream; the current
// ExecutionRecord is a projection rebuilt by replaying events. This module owns
// that contract so the engine, gateway, and strategies all share one shape and
// one replay rule, instead of the agent package's one in-memory Map.

/**
 * Execution status projection (docs/03 §state diagram). The gateway surface
 * (hub) only ever sees `created|running|completed|failed|cancelled` today; the
 * transitional states (`queued`, `waiting_approval`, `paused`, `checkpointed`)
 * are part of the documented machine so the projection layer renders them the
 * moment the engine/orchestrator drives them — representable before runtime.
 */
export type ExecutionStatus =
    | "pending"
    | "queued"
    | "running"
    | "waiting_approval"
    | "paused"
    | "checkpointed"
    | "completed"
    | "failed"
    | "cancelled";

/** Serializable snapshot of an execution at a point in time. */
export type ExecutionRecord = {
    id: string;
    status: ExecutionStatus;
    teamId: string;
    teamName: string;
    task: string;
    startedAt: Date;
    completedAt?: Date;
    /** Last event seq applied; -1 before any event. */
    lastSeq: number;
    /** Running token/cost rollup (from provider cost + observed usage). */
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    /** Optional final result text on completion; error message on failure. */
    output?: string;
    error?: string;
};

/** Lifecycle event types — the durable truth per EXECUTION-STATE.md. */
export type LifecycleEventType =
    | "created"
    | "started"
    | "plan-updated"
    | "tool-executed"
    | "artifact-created"
    | "checkpoint-saved"
    | "paused"
    | "resumed"
    | "retrying"
    | "completed"
    | "failed";

export type ExecutionEvent = {
    /** Unique event id within the store. */
    id: string;
    executionId: string;
    /** Monotonic sequence for this execution — replay order. */
    seq: number;
    type: LifecycleEventType;
    timestamp: Date;
    payload?: Readonly<Record<string, unknown>>;
};

/** A durable checkpoint point-in-time snapshot of an execution. */
export type CheckpointRecord = {
    id: string;
    executionId: string;
    timestamp: Date;
    seq: number;
    reason: string;
    /** Serialized state snapshot (implementation-defined shape). */
    snapshot: Readonly<Record<string, unknown>>;
};
