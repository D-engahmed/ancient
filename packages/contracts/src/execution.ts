// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Layer 3 — Execution Engine lifecycle contract. The durable identity of
// one unit of AI work. Status is owned exclusively by the Lifecycle Manager.

import type { ErrorEnvelope } from "./error";

/** Lifecycle state machine (Layer 3). Only the Lifecycle Manager writes terminal status. */
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

/** What the engine was asked to do (Layer 3.1). */
export interface ExecutionRequest {
  /** Free-form task prompt. */
  task: string;
  /** Optional execution-level budget, in ms. Children must be strictly shorter. */
  budgetMs?: number;
  /** Optional strategy override hint (selection is otherwise the engine's job). */
  strategyHint?: string;
  /** Stable key for idempotent create (Layer 21 §3). */
  idempotencyKey?: string;
}

/** Which strategy (and how) was selected (Layer 3.5). */
export interface StrategySelection {
  strategyId: string;
  /** Bounded: exactly one re-selection is allowed (Layer 3.5). */
  reselection?: { count: number; previousStrategyId: string; reason: ErrorEnvelope };
}

/** The durable execution (Layer 3). */
export interface Execution {
  id: string;
  status: ExecutionStatus;
  request: ExecutionRequest;
  contextRef?: string;
  strategy?: StrategySelection;
  createdAt: Date;
  updatedAt: Date;
  lastError?: ErrorEnvelope;
  retryCount: number;
  checkpointRef?: string;
}

/** Token/usage accounting for one model call or an execution rollup. */
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Real dollar figure when the model runtime knows one; absent = unknown ("Cost unavailable"), never a fabricated 0. */
  costUsd?: number;
};

/** Canonical event stream the engine emits (Layer 3 "Event model"). */
export type ExecutionEventName =
  | "execution.created"
  | "execution.started"
  | "context.ready"
  | "strategy.selected"
  | "model.called"
  | "text.delta"
  | "capability.requested"
  | "capability.completed"
  | "usage.recorded"
  | "approval.requested"
  | "input.requested"
  | "checkpoint.created"
  | "execution.paused"
  | "execution.resumed"
  | "execution.cancelled"
  | "execution.retrying"
  | "execution.degraded"
  | "execution.fallback_engaged"
  | "execution.completed"
  | "execution.failed";

/**
 * Payload of one canonical execution event, discriminated by `type`. The wire
 * spelling (SSE) lives in `@ANCIENT/shared/src/execution-events.ts`; this is the
 * canonical model both sides type against. Additive payload fields are allowed
 * in minor contract versions only; a breaking change requires a new contract `v`.
 *
 * Naming reconciliation (CLI-V2 audit C1/C9): tool calls are the *capability*
 * layer's concern, so they use `capability.requested/completed` (docs/03) and
 * carry `callId`+`tool` in the payload for CLI rendering — no parallel
 * `tool.call.*` vocabulary. `execution.failed` carries the canonical
 * error (Layer 20); a client-safe projection is produced by the gateway (docs/02 §F).
 */
export type ExecutionEvent = {
  type: "execution.created";
  sequence: number;
  occurredAt: string;
  payload: { task: string; mode?: string };
} | {
  type: "execution.started";
  sequence: number;
  occurredAt: string;
  payload: { task: string };
} | {
  type: "context.ready";
  sequence: number;
  occurredAt: string;
  payload: { blocks: readonly string[] };
} | {
  type: "strategy.selected";
  sequence: number;
  occurredAt: string;
  payload: { strategyId: string; rung: number; reason: string };
} | {
  type: "model.called";
  sequence: number;
  occurredAt: string;
  payload: { modelRef: string; provider?: string; durationMs?: number; usage?: TokenUsage };
} | {
  type: "text.delta";
  sequence: number;
  occurredAt: string;
  payload: { text: string };
} | {
  type: "capability.requested";
  sequence: number;
  occurredAt: string;
  payload: { callId: string; capability: string; tool?: string; args?: Record<string, unknown> };
} | {
  type: "capability.completed";
  sequence: number;
  occurredAt: string;
  payload: { callId: string; capability: string; ok: boolean; result?: string; error?: string };
} | {
  type: "usage.recorded";
  sequence: number;
  occurredAt: string;
  payload: TokenUsage;
} | {
  type: "approval.requested";
  sequence: number;
  occurredAt: string;
  payload: { requestId: string; capability: string; prompt?: string };
} | {
  type: "input.requested";
  sequence: number;
  occurredAt: string;
  payload: { requestId: string; prompt?: string };
} | {
  type: "checkpoint.created";
  sequence: number;
  occurredAt: string;
  payload: { checkpointRef: string };
} | {
  type: "execution.paused";
  sequence: number;
  occurredAt: string;
  payload: { reason?: string };
} | {
  type: "execution.resumed";
  sequence: number;
  occurredAt: string;
  payload: Record<never, never>;
} | {
  type: "execution.cancelled";
  sequence: number;
  occurredAt: string;
  payload: { reason?: string };
} | {
  type: "execution.retrying";
  sequence: number;
  occurredAt: string;
  payload: { attempt: number; waitMs?: number };
} | {
  type: "execution.degraded";
  sequence: number;
  occurredAt: string;
  payload: { reason: string };
} | {
  type: "execution.fallback_engaged";
  sequence: number;
  occurredAt: string;
  payload: { from: string; to: string; reason?: string };
} | {
  type: "execution.completed";
  sequence: number;
  occurredAt: string;
  payload: { summary?: string; output?: string; usage?: TokenUsage; costUsd?: number };
} | {
  type: "execution.failed";
  sequence: number;
  occurredAt: string;
  payload: { error: ErrorEnvelope };
};

/** Events after which a stream terminates. Exactly one of these ends a run. */
export const TERMINAL_EXECUTION_EVENTS: readonly ExecutionEventName[] = [
  "execution.completed",
  "execution.failed",
  "execution.cancelled",
] as const;

/** The statuses CLI-V2 renders/controls (Phase-3 decision C11); the rest stay in the type. */
export const CLI_V2_EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  "running",
  "paused",
  "cancelled",
  "completed",
  "failed",
] as const;