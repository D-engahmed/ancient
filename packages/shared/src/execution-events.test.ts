// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 4 — execution event wire contract tests.
// Golden transcripts (byte-stable event sequences) + invariant checks, per the
// design decision that the typed event stream is the stable CLI↔server boundary.

import { describe, expect, test } from "bun:test";
import { TERMINAL_EXECUTION_EVENTS } from "@ANCIENT/contracts";
import {
  executionEventEnvelopeSchema,
  parseExecutionEvent,
  isTerminalExecutionEvent,
  type ExecutionEventEnvelope,
} from "./execution-events";

type WireType = ExecutionEventEnvelope["type"];
type PayloadFor<T extends WireType> = Extract<ExecutionEventEnvelope, { type: T }>["payload"];

function env<T extends WireType>(seq: number, type: T, payload: PayloadFor<T>): ExecutionEventEnvelope {
  return {
    v: 1,
    seq,
    ts: "2026-08-29T00:00:00.000Z",
    executionId: "exec_01",
    type,
    payload,
  } as ExecutionEventEnvelope;
}

describe("execution event wire schema", () => {
  test("parses a live sequence (started → strategy → tool call → completed)", () => {
    const events = [
      env(1, "execution.created", { task: "run the test suite" }),
      env(2, "execution.started", { task: "run the test suite" }),
      env(3, "strategy.selected", { strategyId: "direct", rung: 0, reason: "complexity trivial" }),
      env(4, "text.delta", { text: "Running" }),
      env(5, "text.delta", { text: " tests…" }),
      env(6, "capability.requested", { callId: "call_1", capability: "bash", tool: "bash", args: { command: "bun test" } }),
      env(7, "capability.completed", { callId: "call_1", capability: "bash", ok: true, result: "260 pass" }),
      env(8, "usage.recorded", { inputTokens: 1200, outputTokens: 300, costUsd: 0.0012 }),
      env(9, "execution.completed", { summary: "all green", usage: { inputTokens: 1200, outputTokens: 300 } }),
    ];

    const parsed = events.map((e) => parseExecutionEvent(e));
    expect(parsed).toHaveLength(9);
    for (let i = 0; i < parsed.length; i++) {
      expect(parsed[i]!.seq).toBe(i + 1);
      expect(parsed[i]!.type).toBe(events[i]!.type);
    }
    expect(isTerminalExecutionEvent(parsed.at(-1)!)).toBe(true);
  });

  test("golden transcript — text deltas concatenate in order, tool call is self-contained", () => {
    const transcript = [
      env(1, "execution.started", { task: "summarize" }),
      env(2, "text.delta", { text: "Hello " }),
      env(3, "text.delta", { text: "world" }),
      env(4, "execution.completed", { output: "Hello world" }),
    ];
    const deltas = transcript
      .map((e) => parseExecutionEvent(e))
      .filter((e): e is Extract<ExecutionEventEnvelope, { type: "text.delta" }> => e.type === "text.delta");
    expect(deltas.map((d) => d.payload.text).join("")).toBe("Hello world");
  });

  test("execution.failed carries the client-safe error envelope", () => {
    const failed = env(99, "execution.failed", {
      error: {
        code: "PROVIDER_RATE_LIMITED",
        message: "Provider rate limited — retry later",
        retryable: true,
        retryAfterMs: 30_000,
        traceId: "t-abc123",
      },
    });
    const parsed = parseExecutionEvent(failed);
    if (parsed.type !== "execution.failed") throw new Error("expected execution.failed");
    expect(parsed.payload.error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(parsed.payload.error.retryable).toBe(true);
  });

  test("rejects malformed envelopes", () => {
    // wrong version
    expect(() => parseExecutionEvent({ ...env(1, "execution.started", { task: "x" }), v: 2 })).toThrow(/Invalid execution event/);
    // seq must be positive
    expect(() => parseExecutionEvent(env(0, "execution.started", { task: "x" }))).toThrow(/Too small/);
    // missing executionId
    expect(() => parseExecutionEvent({ ...env(1, "execution.started", { task: "x" }), executionId: "" })).toThrow(/expected string to have >=1 characters/);
    // non-ISO ts
    expect(() => parseExecutionEvent({ ...env(1, "execution.started", { task: "x" }), ts: "not-a-date" })).toThrow(/ts/);
    // unknown event type
    expect(() => parseExecutionEvent(env(1, "execution.exploded" as never, { task: "x" } as never))).toThrow();
    // failed event must carry an error envelope
    expect(() => parseExecutionEvent(env(1, "execution.failed", {} as never))).toThrow();
  });

  test("additive/per-type payload narrowing works after parse", () => {
    const parsed = parseExecutionEvent(env(1, "capability.requested", {
      callId: "c1", capability: "readFile", tool: "readFile", args: { path: ".gitignore" },
    }));
    if (parsed.type !== "capability.requested") throw new Error("expected capability.requested");
    // narrowing gives typed access to the payload
    expect(parsed.payload.callId).toBe("c1");
    expect(parsed.payload.tool).toBe("readFile");
  });

  test("TERMINAL matches the canonical set from contracts", () => {
    expect([...TERMINAL_EXECUTION_EVENTS]).toEqual(["execution.completed", "execution.failed", "execution.cancelled"]);
    expect(isTerminalExecutionEvent({ type: "execution.cancelled" })).toBe(true);
    expect(isTerminalExecutionEvent({ type: "text.delta" })).toBe(false);
  });

  test("events are rejectable but round-trip through the schema", () => {
    for (const e of [
      env(1, "execution.paused", { reason: "user pressed P" }),
      env(2, "execution.resumed", {}),
      env(3, "input.requested", { requestId: "req_1", prompt: "approve file write?" }),
      env(4, "checkpoint.created", { checkpointRef: "ckpt_1" }),
      env(5, "execution.fallback_engaged", { from: "llama-4-scout:free", to: "gemma-3-1b-it:free", reason: "rate limited" }),
      env(6, "execution.degraded", { reason: "memory unavailable" }),
      env(7, "execution.cancelled", { reason: "user interrupt" }),
    ]) {
      const parsed = executionEventEnvelopeSchema.parse(e);
      expect(parsed.type).toBe(e.type);
    }
  });
});