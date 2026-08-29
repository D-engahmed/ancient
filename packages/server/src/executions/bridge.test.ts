// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Execution event bridge tests (CLI-V2 Phase 5, C9).
// Verifies the engine→wire translation: 1-based gapless seq, exact type
// mapping, capability callId pairing, terminal semantics, and replay slices.

import { describe, expect, test } from "bun:test";
import type { LifecycleEvent } from "@ANCIENT/infrastructure/events";
import type { StrategyEvent } from "@ANCIENT/strategies";
import type { ExecutionEventEnvelope } from "@ANCIENT/shared";
import { ExecutionEventBridge } from "./bridge";

function lifecycle(type: LifecycleEvent["type"], payload?: Record<string, unknown>): LifecycleEvent {
  return { id: `evt-${type}`, executionId: "EXEC", seq: 0, type, timestamp: new Date(), payload };
}

describe("ExecutionEventBridge — engine → wire mapping", () => {
  function fresh(): ExecutionEventBridge {
    const bridge = new ExecutionEventBridge();
    bridge.start({ executionId: "EXEC", task: "run tests", mode: "BUILD" });
    return bridge;
  }

  test("happy path: gapless 1-based seq, exact type order", () => {
    const bridge = fresh();

    bridge.onLifecycleEvent(lifecycle("started", { strategy: "direct", rung: 0, reason: "trivial", task: "run tests" }));
    bridge.onStrategyEvent({ type: "text-delta", text: "Running " });
    bridge.onStrategyEvent({ type: "text-delta", text: "tests…" });
    bridge.onStrategyEvent({ type: "tool-call", call: { id: "call_1", name: "bash", args: { command: "bun test" } } });
    bridge.onStrategyEvent({ type: "tool-result", callId: "call_1", result: "267 pass", error: undefined });
    bridge.onLifecycleEvent(lifecycle("completed", { turnCount: 2, toolCount: 1, usage: { inputTokens: 10, outputTokens: 5 } }));

    const events: ExecutionEventEnvelope[] = bridge.snapshot();
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(events.map((e) => e.type)).toEqual([
      "execution.created",
      "strategy.selected",
      "execution.started",
      "text.delta",
      "text.delta",
      "capability.requested",
      "capability.completed",
      "execution.completed",
    ]);
    expect(bridge.lastSeq).toBe(8);
    expect(bridge.closed).toBe(true);
  });

  test("strategy.selected carries rung/reason and all envelopes share the execution id", () => {
    const bridge = fresh();
    bridge.onLifecycleEvent(lifecycle("started", { strategy: "direct", rung: 2, reason: "moderate", task: "t" }));

    const snap = bridge.snapshot();
    const created: ExecutionEventEnvelope = snap[0]!;
    const selected = snap[1]!;
    const started = snap[2]!;
    expect(created.type).toBe("execution.created");
    expect((created.payload as { task: string }).task).toBe("run tests");

    const sel = selected as Extract<ExecutionEventEnvelope, { type: "strategy.selected" }>;
    expect(sel.payload).toEqual({ strategyId: "direct", rung: 2, reason: "moderate" });

    const st = started as Extract<ExecutionEventEnvelope, { type: "execution.started" }>;
    expect(st.payload.task).toBe("t");
    for (const e of bridge.snapshot()) expect(e.executionId).toBe("EXEC");
  });

  test("tool-call → tool-result round-trip preserves callId and capability name", () => {
    const bridge = fresh();
    const path = ".gitignore";
    bridge.onStrategyEvent({ type: "tool-call", call: { id: "c9", name: "readFile", args: { path } } });
    bridge.onStrategyEvent({ type: "tool-result", callId: "c9", result: "contents", error: undefined });

    const [req] = bridge.snapshot().filter((e) => e.type === "capability.requested");
    const [res] = bridge.snapshot().filter((e) => e.type === "capability.completed");
    const requested = req as Extract<ExecutionEventEnvelope, { type: "capability.requested" }>;
    const completed = res as Extract<ExecutionEventEnvelope, { type: "capability.completed" }>;

    expect(requested.payload.callId).toBe("c9");
    expect(requested.payload.capability).toBe("readFile");
    expect((requested.payload.args as Record<string, unknown>).path).toBe(path);
    expect(completed.payload.callId).toBe("c9");
    expect(completed.payload.capability).toBe("readFile");
    expect(completed.payload.ok).toBe(true);
    expect(completed.payload.result).toBe("contents");
  });

  test("failed tool-result maps ok:false with the error on the wire", () => {
    const bridge = fresh();
    bridge.onStrategyEvent({ type: "tool-call", call: { id: "x", name: "bash", args: {} } });
    bridge.onStrategyEvent({ type: "tool-result", callId: "x", result: "", error: "command failed" });

    const completed = bridge.snapshot().at(-1) as Extract<ExecutionEventEnvelope, { type: "capability.completed" }>;
    expect(completed.payload.ok).toBe(false);
    expect(completed.payload.error).toBe("command failed");
  });

  test("text deltas accumulate into the completed output", () => {
    const bridge = fresh();
    bridge.onStrategyEvent({ type: "text-delta", text: "Hello " });
    bridge.onStrategyEvent({ type: "text-delta", text: "world" });
    bridge.onLifecycleEvent(lifecycle("completed", { turnCount: 1, toolCount: 0, usage: { inputTokens: 1, outputTokens: 1 } }));

    const done = bridge.snapshot().at(-1) as Extract<ExecutionEventEnvelope, { type: "execution.completed" }>;
    expect(done.payload.output).toBe("Hello world");
  });

  test("usage rides onto execution.completed; costUsd stays absent when unknown", () => {
    const bridge = fresh();
    bridge.onLifecycleEvent(lifecycle("completed", { turnCount: 1, toolCount: 0, usage: { inputTokens: 7, outputTokens: 3 } }));

    const done = bridge.snapshot().at(-1)! as Extract<ExecutionEventEnvelope, { type: "execution.completed" }>;
    expect(done.payload.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect("costUsd" in (done.payload.usage ?? {})).toBe(false);
  });

  test("cancellation is a terminal execution.cancelled, never a failed", () => {
    const bridge = fresh();
    bridge.onLifecycleEvent(lifecycle("failed", { reason: "cancelled", message: "user interrupt" }));

    const last = bridge.snapshot().at(-1)!;
    expect(last.type).toBe("execution.cancelled");
    expect((last.payload as { reason?: string }).reason).toBe("user interrupt");
    expect(bridge.closed).toBe(true);
  });

  test("failure maps to execution.failed with a client-safe envelope", () => {
    const bridge = fresh();
    bridge.onLifecycleEvent(lifecycle("failed", { message: "provider blew up" }));

    const last = bridge.snapshot().at(-1)! as Extract<ExecutionEventEnvelope, { type: "execution.failed" }>;
    expect(last.payload.error.code).toBe("SYSTEM_UNKNOWN");
    expect(last.payload.error.message).toBe("provider blew up");
    expect(last.payload.error.retryable).toBe(false);
    expect(last.payload.error.traceId.length).toBeGreaterThan(0);
    expect(bridge.closed).toBe(true);
  });

  test("post-terminal lifecycle events are ignored (exactly one terminal)", () => {
    const bridge = fresh();
    bridge.onLifecycleEvent(lifecycle("completed", {}));
    const before = bridge.snapshot().length;
    bridge.onLifecycleEvent(lifecycle("failed", { message: "late" })); // must be ignored
    expect(bridge.snapshot().length).toBe(before);
    expect(bridge.snapshot().at(-1)!.type).toBe("execution.completed");
  });

  test("unmapped lifecycle/strategy events do not consume seq (forward compat)", () => {
    const bridge = fresh();
    bridge.onLifecycleEvent(lifecycle("plan-updated", { plan: "x" }));
    bridge.onLifecycleEvent(lifecycle("tool-executed", { tool: "bash", ok: true }));
    bridge.onStrategyEvent({ type: "subtask", subtaskId: "s", goal: "g", status: "completed" });
    bridge.onStrategyEvent({ type: "error", message: "non-fatal" });
    expect(bridge.snapshot().length).toBe(1); // only execution.created
    expect(bridge.lastSeq).toBe(1);
  });

  test("snapshot(afterSeq) returns only the later slice (Last-Event-ID replay)", () => {
    const bridge = fresh();
    bridge.onLifecycleEvent(lifecycle("started", { strategy: "direct", rung: 0, reason: "t" }));
    bridge.onStrategyEvent({ type: "text-delta", text: "a" });
    bridge.onStrategyEvent({ type: "text-delta", text: "b" });

    const replays = bridge.snapshot(2);
    // seq: created=1, strategy.selected=2, execution.started=3, text-a=4, text-b=5
    expect(replays.map((e) => e.seq)).toEqual([3, 4, 5]);
  });
});

describe("ExecutionEventBridge — live listeners", () => {
  test("subscribers receive every envelope in order; unsubscribe stops delivery", () => {
    const bridge = new ExecutionEventBridge();
    bridge.start({ executionId: "EXEC", task: "t", mode: "BUILD" });

    const seen: string[] = [];
    const off = bridge.subscribe((e) => seen.push(e.type));
    bridge.onStrategyEvent({ type: "text-delta", text: "x" });
    off();
    bridge.onStrategyEvent({ type: "text-delta", text: "y" });

    // execution.created was emitted inside start(), before subscribing.
    expect(seen).toEqual(["text.delta"]);
  });
});