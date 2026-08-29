// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 4 — execution event wire contract (SSE envelope).
//
// The canonical event model lives in @ANCIENT/contracts/execution.ts (zero-dep
// types + the discriminated ExecutionEvent payload union). This module is the
// runtime-validated WIRE spelling of those events — `{v, seq, ts,
// executionId, type, payload}` — consumed by the CLI and, later, produced by
// the gateway SSE stream (Phase 5). It lives in @ANCIENT/shared alongside the
// other wire schemas (submitSchema, messagePartsSchema) so both server and CLI
// validate against one edge schema.
//
// Invariants (from the CLI-V2 audit C1-C3):
//   1. `seq` is 1-based and gapless per execution — drives `Last-Event-ID` replay.
//   2. Exactly one terminal event ends a run; the server closes the stream after it.
//   3. Clients MUST ignore unknown event types (forward compatibility).
//   4. `capability.requested(callId)` always precedes its `capability.completed`.
//   5. `v: 1` never changes shape; breaking changes = new `v` served side-by-side.
//   6. Events are past-tense facts. The lone exception, `input.requested`,
//      is answered via POST /executions/:id/inputs/:requestId (Phase 5).

import { z } from "zod";
import { ERROR_CODES, TERMINAL_EXECUTION_EVENTS } from "@ANCIENT/contracts";

/** Wire version of one client-safe failure (docs/02 §F; Layer 20 projection). */
export const errorEnvelopeSchema = z.object({
  code: z.enum(ERROR_CODES as unknown as [string, ...string[]]),
  /** Safe-for-client summary — the gateway maps ErrorEnvelope.clientMessage ?? message. */
  message: z.string(),
  /** True when retrying unchanged is expected to succeed. */
  retryable: z.boolean(),
  /** Honor when present (e.g. provider rate limits). */
  retryAfterMs: z.number().int().positive().optional(),
  /** Always present; the thread through Layer 7 observability. */
  traceId: z.string().min(1),
});
export type ClientSafeError = z.infer<typeof errorEnvelopeSchema>;

const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Absent when unknown — the CLI renders "Cost unavailable", never a fabricated 0. */
  costUsd: z.number().nonnegative().optional(),
});

const isoDateString = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "ts must be an ISO-8601 date");

/**
 * Envelope base; v/seq/ts/executionId are invariant across every event type.
 * NOTE: each member spells its own `type: z.literal(...)` (never a generic/T
 * helper) — a generic schema widens `type` to `string` and breaks the
 * discriminated-union narrowing the CLI relies on (verified against zod v4).
 */
const envelopeBase = z.object({
  v: z.literal(1),
  seq: z.number().int().positive(),
  ts: isoDateString,
  executionId: z.string().min(1),
});

const executionCreatedEnvelope = envelopeBase.extend({
  type: z.literal("execution.created"),
  payload: z.object({ task: z.string(), mode: z.string().optional() }),
});
const executionStartedEnvelope = envelopeBase.extend({
  type: z.literal("execution.started"),
  payload: z.object({ task: z.string() }),
});
const contextReadyEnvelope = envelopeBase.extend({
  type: z.literal("context.ready"),
  payload: z.object({ blocks: z.array(z.string()) }),
});
const strategySelectedEnvelope = envelopeBase.extend({
  type: z.literal("strategy.selected"),
  payload: z.object({
    strategyId: z.string(),
    rung: z.number().int().nonnegative(),
    reason: z.string(),
  }),
});
const modelCalledEnvelope = envelopeBase.extend({
  type: z.literal("model.called"),
  payload: z.object({
    modelRef: z.string(),
    provider: z.string().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    usage: tokenUsageSchema.optional(),
  }),
});
const textDeltaEnvelope = envelopeBase.extend({
  type: z.literal("text.delta"),
  payload: z.object({ text: z.string() }),
});
const capabilityRequestedEnvelope = envelopeBase.extend({
  type: z.literal("capability.requested"),
  payload: z.object({
    callId: z.string().min(1),
    capability: z.string(),
    tool: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
});
const capabilityCompletedEnvelope = envelopeBase.extend({
  type: z.literal("capability.completed"),
  payload: z.object({
    callId: z.string().min(1),
    capability: z.string(),
    ok: z.boolean(),
    result: z.string().optional(),
    error: z.string().optional(),
  }),
});
const usageRecordedEnvelope = envelopeBase.extend({
  type: z.literal("usage.recorded"),
  payload: tokenUsageSchema,
});
const approvalRequestedEnvelope = envelopeBase.extend({
  type: z.literal("approval.requested"),
  payload: z.object({
    requestId: z.string().min(1),
    capability: z.string(),
    prompt: z.string().optional(),
  }),
});
const inputRequestedEnvelope = envelopeBase.extend({
  type: z.literal("input.requested"),
  payload: z.object({
    requestId: z.string().min(1),
    prompt: z.string().optional(),
  }),
});
const checkpointCreatedEnvelope = envelopeBase.extend({
  type: z.literal("checkpoint.created"),
  payload: z.object({ checkpointRef: z.string() }),
});
const executionPausedEnvelope = envelopeBase.extend({
  type: z.literal("execution.paused"),
  payload: z.object({ reason: z.string().optional() }),
});
const executionResumedEnvelope = envelopeBase.extend({
  type: z.literal("execution.resumed"),
  payload: z.object({}),
});
const executionCancelledEnvelope = envelopeBase.extend({
  type: z.literal("execution.cancelled"),
  payload: z.object({ reason: z.string().optional() }),
});
const executionRetryingEnvelope = envelopeBase.extend({
  type: z.literal("execution.retrying"),
  payload: z.object({
    attempt: z.number().int().positive(),
    waitMs: z.number().int().nonnegative().optional(),
  }),
});
const executionDegradedEnvelope = envelopeBase.extend({
  type: z.literal("execution.degraded"),
  payload: z.object({ reason: z.string() }),
});
const executionFallbackEnvelope = envelopeBase.extend({
  type: z.literal("execution.fallback_engaged"),
  payload: z.object({
    from: z.string(),
    to: z.string(),
    reason: z.string().optional(),
  }),
});
const executionCompletedEnvelope = envelopeBase.extend({
  type: z.literal("execution.completed"),
  payload: z.object({
    summary: z.string().optional(),
    output: z.string().optional(),
    usage: tokenUsageSchema.optional(),
    costUsd: z.number().nonnegative().optional(),
  }),
});
const executionFailedEnvelope = envelopeBase.extend({
  type: z.literal("execution.failed"),
  payload: z.object({ error: errorEnvelopeSchema }),
});

/** Wire payload schemas, mirroring the canonical payload union in contracts. */
export const executionEventEnvelopeSchema = z.union([
  executionCreatedEnvelope,
  executionStartedEnvelope,
  contextReadyEnvelope,
  strategySelectedEnvelope,
  modelCalledEnvelope,
  textDeltaEnvelope,
  capabilityRequestedEnvelope,
  capabilityCompletedEnvelope,
  usageRecordedEnvelope,
  approvalRequestedEnvelope,
  inputRequestedEnvelope,
  checkpointCreatedEnvelope,
  executionPausedEnvelope,
  executionResumedEnvelope,
  executionCancelledEnvelope,
  executionRetryingEnvelope,
  executionDegradedEnvelope,
  executionFallbackEnvelope,
  executionCompletedEnvelope,
  executionFailedEnvelope,
]);

export type ExecutionEventEnvelope = z.infer<typeof executionEventEnvelopeSchema>;
export type ExecutionEventPayload = ExecutionEventEnvelope["payload"];

/** Events after which a stream must end (exactly one terminates a run). */
export const TERMINAL = TERMINAL_EXECUTION_EVENTS;

export function isTerminalExecutionEvent(event: Pick<ExecutionEventEnvelope, "type">): boolean {
  return (TERMINAL_EXECUTION_EVENTS as readonly string[]).includes(event.type);
}

/** Validate at the edge; throws on any malformed/unknown event. */
export function parseExecutionEvent(raw: unknown): ExecutionEventEnvelope {
  const parsed = executionEventEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => i.message).join("; ");
    throw new Error(`Invalid execution event: ${detail}`);
  }
  return parsed.data;
}