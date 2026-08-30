// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Execution event bridge (CLI-V2 Phase 5, contract C9).
//
// Translates the engine's emissions — lifecycle events on the infra EventBus
// plus observed strategy events — into the typed WIRE envelopes of
// @ANCIENT/shared/execution-events, in ONE gapless 1-based sequence (the wire
// contract's `seq` invariant, which drives Last-Event-ID replay).
//
// Single subscription model: the gateway creates ONE MemoryEventBus per
// execution and hands it to the engine as `request.bus`, subscribes here, and
// passes `request.observe` for strategy events. Both channels arrive in stream
// order (the bus is synchronous), so the bridge's single counter is an honest
// total order of what the session actually did.

import type { LifecycleEvent, Listener } from "@ANCIENT/infrastructure/events";
import type { ExecutionStatus as StoreStatus } from "@ANCIENT/infrastructure/storage";
import type { ErrorEnvelope } from "@ANCIENT/contracts";
import {
  executionEventEnvelopeSchema,
  TERMINAL,
  type ClientSafeError,
  type ExecutionEventEnvelope,
  type ExecutionEventPayload,
} from "@ANCIENT/shared";
import type { StrategyEvent } from "@ANCIENT/strategies";

/** One subscribed SSE consumer: receives every new envelope in order. */
export type EventListener = (event: ExecutionEventEnvelope) => void;
export type Unsubscribe = () => void;

export type BridgeStart = {
  /** The created execution's id (from the engine session). */
  executionId: string;
  /** Buffered envelopes so far (ended with a terminal event when done). */
  buffer: readonly ExecutionEventEnvelope[];
};

/**
 * Per-execution translation of engine emissions → wire envelopes. Both
 * `observe` (strategy events) and the bus listener funnel into one gapless
 * `seq` counter, keeping the wire's replay contract free of gaps or renumbering.
 */
export class ExecutionEventBridge {
  #executionId: string | undefined;
  #seq = 0;
  #events: ExecutionEventEnvelope[] = [];
  #listeners = new Set<EventListener>();
  /** callId → tool/capability name, so tool-result maps back to its request. */
  #pendingCalls = new Map<string, string>();
  #textChunks: string[] = [];
  #closed = false;

  /** seq of the last buffered event (0 before any). */
  get lastSeq(): number {
    return this.#seq;
  }

  /** True once a terminal event was buffered. */
  get closed(): boolean {
    return this.#closed;
  }

  /** Snapshot copy; replay honors the wire's gapless-seq rule. */
  snapshot(afterSeq = 0): ExecutionEventEnvelope[] {
    return this.#events.filter((e) => e.seq > afterSeq);
  }

  /** Remove a listener (safe to call from inside delivery). */
  unsubscribe(listener: EventListener): void {
    this.#listeners.delete(listener);
  }

  /** Subscribe to live envelopes; returns the unsubscribe handle. */
  subscribe(listener: EventListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.unsubscribe(listener);
  }

  get executionId(): string {
    if (!this.#executionId) throw new Error("bridge: execution not started");
    return this.#executionId;
  }

  /** Call with the engine session once `engine.run` returns a live session. */
  start(params: { executionId: string; task: string; mode?: string }): BridgeStart {
    if (this.#executionId) throw new Error("bridge: already started");
    this.#executionId = params.executionId;
    this.#emit(this.#build("execution.created", { task: params.task, ...(params.mode ? { mode: params.mode } : {}) }));
    return { executionId: params.executionId, buffer: this.snapshot() };
  }

  /** Wires the endpoint of the run: terminal + rollup, no double-terminals. */
  finish(status: StoreStatus, detail?: { output?: string; usage?: { inputTokens: number; outputTokens: number; costUsd?: number }; summary?: string; error?: string; clientError?: ClientSafeError }): void {
    if (this.#closed) return;
    const output = detail?.output ?? this.#textChunks.join("");
    const usage = detail?.usage;

    if (status === "cancelled") {
      this.#emit(this.#build("execution.cancelled", { ...(detail?.error ? { reason: detail.error } : {}) }));
    } else if (status === "failed") {
      this.#emit(this.#build("execution.failed", {
        error: detail?.clientError ?? {
          code: "SYSTEM_UNKNOWN",
          message: detail?.error ?? "execution failed",
          retryable: false,
          traceId: this.#traceId(),
        },
      }));
    } else {
      this.#emit(this.#build("execution.completed", {
        ...(detail?.summary ? { summary: detail.summary } : {}),
        ...(output ? { output } : {}),
        ...(usage ? { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}) } } : {}),
      }));
    }
  }

  /** Emit an approval.requested event for the consent bridge (Phase 9). */
  emitApprovalRequested(executionId: string, detail: { requestId: string; capability: string; prompt?: string }): void {
    if (this.#closed) return;
    this.#emit(this.#build("approval.requested", {
      requestId: detail.requestId,
      capability: detail.capability,
      ...(detail.prompt ? { prompt: detail.prompt } : {}),
    }));
  }

  /** Direct bridging entry — translate one infra lifecycle event. */
  onLifecycleEvent(event: LifecycleEvent): void {
    if (this.#closed || event.executionId !== this.#executionId) return;
    switch (event.type) {
      case "started":
        // The one guaranteed selection signal from the engine (rung/reason).
        this.#emit(this.#build("strategy.selected", {
          strategyId: String(event.payload?.strategy ?? "unknown"),
          rung: Number(event.payload?.rung ?? 0),
          reason: String(event.payload?.reason ?? ""),
        }));
        this.#emit(this.#build("execution.started", { task: this.#taskHint(event) }));
        break;
      case "paused":
        this.#emit(this.#build("execution.paused", { ...(event.payload?.reason ? { reason: String(event.payload.reason) } : {}) }));
        break;
      case "resumed":
        this.#emit(this.#build("execution.resumed", {}));
        break;
      case "completed": {
        const usage = event.payload?.usage && typeof event.payload.usage === "object"
          ? { inputTokens: Number((event.payload.usage as { inputTokens?: unknown }).inputTokens ?? 0), outputTokens: Number((event.payload.usage as { outputTokens?: unknown }).outputTokens ?? 0) }
          : undefined;
        this.finish("completed", {
          summary: typeof event.payload?.summary === "string" ? event.payload.summary : undefined,
          usage,
        });
        break;
      }
      case "failed": {
        // The engine publishes the terminal ErrorEnvelope (Layer 20) on the
        // lifecycle event; pass its code/retryability through instead of the
        // blanket SYSTEM_UNKNOWN the wire used to fabricate.
        const cancelled = event.payload?.reason === "cancelled" || event.payload?.terminal === "cancelled";
        const envelope = event.payload?.error as ErrorEnvelope | undefined;
        this.finish(cancelled ? "cancelled" : "failed", {
          error: typeof event.payload?.message === "string" ? event.payload.message : "execution failed",
          ...(envelope ? { clientError: this.#clientError(envelope) } : {}),
        });
        break;
      }
      case "retrying":
        // Failed → Queued for transient errors (docs/03): surface the bounded
        // retry so the CLI is honest about why the run is still alive.
        this.#emit(this.#build("execution.retrying", {
          attempt: Number(event.payload?.attempt ?? 1),
          ...(event.payload?.waitMs !== undefined ? { waitMs: Number(event.payload.waitMs) } : {}),
        }));
        break;
      default:
        // "created" is emitted by bridge.start(); "plan-updated" /
        // "tool-executed" / "artifact-created" / "checkpoint-saved" have no
        // wire event yet — ignore (forward compatibility).
        break;
    }
  }

  /** Direct bridging entry — translate one observed strategy event. */
  onStrategyEvent(event: StrategyEvent): void {
    if (this.#closed) return;
    switch (event.type) {
      case "text-delta":
        this.#textChunks.push(event.text);
        this.#emit(this.#build("text.delta", { text: event.text }));
        break;
      case "tool-call": {
        const name = event.call.name;
        const callId = event.call.id || `call_${this.#seq + 1}`;
        this.#pendingCalls.set(callId, name);
        this.#emit(this.#build("capability.requested", {
          callId,
          capability: name,
          ...(name ? { tool: name } : {}),
          ...(event.call.args !== undefined && event.call.args !== null ? { args: event.call.args as Record<string, unknown> } : {}),
        }));
        break;
      }
      case "tool-result": {
        const capability = this.#pendingCalls.get(event.callId) ?? "?";
        this.#pendingCalls.delete(event.callId);
        this.#emit(this.#build("capability.completed", {
          callId: event.callId,
          capability,
          ok: !event.error,
          ...(event.error ? { error: event.error } : { result: event.result }),
        }));
        break;
      }
      default:
        // strategy-selected/subtask/done/error: covered by the lifecycle bus
        // (started/completed/failed) or intentionally not surfaced on the wire.
        break;
    }
  }

  #taskHint(event: LifecycleEvent): string {
    const t = event.payload?.task;
    return typeof t === "string" ? t : "";
  }

  #traceId(): string {
    try {
      return crypto.randomUUID();
    } catch {
      return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
  }

  /** Project a canonical ErrorEnvelope (Layer 20 §1) onto the safe wire shape
   *  (clientMessage ?? message; code + retryability passed through). */
  #clientError(envelope: ErrorEnvelope): ClientSafeError {
    return {
      code: envelope.code,
      message: envelope.clientMessage ?? envelope.message,
      retryable: envelope.transient,
      traceId: envelope.traceId,
    };
  }

  #build(type: ExecutionEventEnvelope["type"], payload: ExecutionEventPayload): ExecutionEventEnvelope {
    return {
      v: 1,
      seq: ++this.#seq,
      ts: new Date().toISOString(),
      executionId: this.#executionId ?? "",
      type,
      payload,
    } as ExecutionEventEnvelope;
  }

  #emit(event: ExecutionEventEnvelope): void {
    // Edge validation keeps the subscription path honest: a bridge bug must
    // surface here, not as an unparseable SSE frame downstream.
    const parsed = executionEventEnvelopeSchema.safeParse(event);
    if (!parsed.success) {
      throw new Error(`bridge: produced invalid envelope: ${event.type}`);
    }
    this.#events.push(parsed.data);
    if (TERMINAL_TYPES.has(parsed.data.type)) this.#closed = true;
    for (const listener of [...this.#listeners]) listener(parsed.data);
  }
}

const TERMINAL_TYPES = new Set<ExecutionEventEnvelope["type"]>(TERMINAL);

export type { Listener as BusListener };