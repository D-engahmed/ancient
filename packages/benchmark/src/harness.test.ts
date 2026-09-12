// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Benchmark tests (benchmark) — the invariant checks flag each failure mode,
// and the wiring test drives the REAL engine + REAL tools + REAL store over a
// scripted model port, proving the harness asserts what it claims.

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeError, type RetryBudget } from "@ANCIENT/contracts";
import { ExecutionEngine } from "@ANCIENT/execution";
import { DEFAULT_RETRY_BUDGET } from "@ANCIENT/execution/runner";
import type { ModelTurnResult } from "@ANCIENT/strategies";
import { benchEngine, runBenchmarkTask, type RunTrace } from "./harness";
import { BENCHMARK_TASKS } from "./tasks";
import { checkInvariants, checkNoCorruptedState, checkNoFakeCompletions, checkNoLostStreams, checkNoStuck, checkNoUncontrolledRetries, checkNoUnexplainedFailures, violationsByInvariant, type Violation } from "./invariants";

const BUDGET: RetryBudget = { ...DEFAULT_RETRY_BUDGET, maxAttempts: 2 };

function trace(overrides: Partial<RunTrace> & Pick<RunTrace, "taskId" | "status">): RunTrace {
  return {
    task: "",
    categories: ["read"],
    durationMs: 0,
    lifecycle: [],
    terminal: [],
    observed: [],
    recorded: [],
    seqGaps: [],
    timestampInversions: 0,
    eventsAfterTerminal: 0,
    recordedDeltas: "",
    observedDeltas: "",
    retryCount: 0,
    retryingCount: 0,
    degradeCount: 0,
    timeoutMs: 1000,
    ...overrides,
  };
}

function scripted(turns: ModelTurnResult[]): Parameters<typeof runBenchmarkTask>[0]["modelChat"] {
  let i = 0;
  return async () => turns[Math.min(i++, turns.length - 1)]!;
}

function turn(text: string, toolCalls: ModelTurnResult["toolCalls"] = []): ModelTurnResult {
  return { text, toolCalls, usage: { inputTokens: 10, outputTokens: 5 } };
}

const call = (name: string, args: unknown) => ({ id: `c${Math.random().toString(36).slice(2, 8)}`, name, args });

describe("invariant checks", () => {
  it("I1 flags a timed-out (stuck) session", () => {
    const v: Violation[] = [];
    checkNoStuck(trace({ taskId: "t", status: "timeout" }), v);
    checkNoStuck(trace({ taskId: "t", status: "orchestration-error" }), v);
    checkNoStuck(trace({ taskId: "t", status: "completed" }), v);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ invariant: "I1-no-stuck" });
  });

  it("I2 flags fake/blank completions and a doubled terminal", () => {
    const v: Violation[] = [];
    // tools ran but empty answer
    checkNoFakeCompletions(
      trace({ taskId: "t", status: "completed", result: { sessionId: "s", status: "completed", strategy: { id: "direct", rung: 0, reason: "" }, turnCount: 1, toolCount: 3, usage: { inputTokens: 0, outputTokens: 0 }, retryCount: 0 }, terminal: [{ id: "e", executionId: "x", seq: 2, type: "completed", timestamp: new Date() }] }),
      v,
    );
    // two terminal events
    checkNoFakeCompletions(
      trace({ taskId: "t", status: "completed", result: { sessionId: "s", status: "completed", strategy: { id: "direct", rung: 0, reason: "" }, turnCount: 1, toolCount: 0, usage: { inputTokens: 0, outputTokens: 0 }, retryCount: 0, output: "done" }, terminal: [{ id: "e1", executionId: "x", seq: 2, type: "completed", timestamp: new Date() }, { id: "e2", executionId: "x", seq: 3, type: "completed", timestamp: new Date() }] }),
      v,
    );
    // clean, tools + answer, single terminal event
    checkNoFakeCompletions(
      trace({ taskId: "t", status: "completed", result: { sessionId: "s", status: "completed", strategy: { id: "direct", rung: 0, reason: "" }, turnCount: 1, toolCount: 1, usage: { inputTokens: 0, outputTokens: 0 }, retryCount: 0, output: "the answer" }, terminal: [{ id: "e", executionId: "x", seq: 2, type: "completed", timestamp: new Date() }] }),
      v,
    );
    // tools ran + empty output (2), doubled terminal (1), clean (0)
    expect(v).toHaveLength(3);
  });

  it("I3 flags a stream divergence between observe and session", () => {
    const v: Violation[] = [];
    checkNoLostStreams(
      trace({
        taskId: "t",
        status: "completed",
        recorded: [{ type: "text-delta", text: "hello" }] as RunTrace["recorded"],
        observed: [{ type: "text-delta", text: "hell" }] as RunTrace["observed"],
        recordedDeltas: "hello",
        observedDeltas: "hell",
        result: { sessionId: "s", status: "completed", strategy: { id: "direct", rung: 0, reason: "" }, turnCount: 1, toolCount: 0, usage: { inputTokens: 0, outputTokens: 0 }, retryCount: 0, output: "hello" },
      }),
      v,
    );
    expect(v.some((x) => x.invariant === "I3-no-lost-streams" && x.detail.includes("text deltas diverged"))).toBe(true);
  });

  it("I4 flags a gapless-seq break and a projection mismatch", () => {
    const v: Violation[] = [];
    checkNoCorruptedState(
      trace({ taskId: "t", status: "completed", seqGaps: [4], result: { sessionId: "s", status: "completed", strategy: { id: "direct", rung: 0, reason: "" }, turnCount: 0, toolCount: 0, usage: { inputTokens: 0, outputTokens: 0 }, retryCount: 0 }, projectedStatus: "completed" }),
      v,
    );
    checkNoCorruptedState(
      trace({ taskId: "t", status: "failed", result: { sessionId: "s", status: "failed", strategy: { id: "direct", rung: 0, reason: "" }, turnCount: 0, toolCount: 0, usage: { inputTokens: 0, outputTokens: 0 }, retryCount: 0, error: "x", lastError: makeError({ code: "PROVIDER_UNAVAILABLE", domain: "provider", message: "x" }) }, projectedStatus: "running" }),
      v,
    );
    const clean: Violation[] = [];
    checkNoCorruptedState(
      trace({ taskId: "t", status: "completed", projectedStatus: "completed", result: { sessionId: "s", status: "completed", strategy: { id: "direct", rung: 0, reason: "" }, turnCount: 0, toolCount: 0, usage: { inputTokens: 0, outputTokens: 0 }, retryCount: 0 } }),
      clean,
    );
    expect(v).toHaveLength(2);
    expect(clean).toHaveLength(0);
  });

  it("I5 flags retries over the budget and retrying-count mismatches", () => {
    const v: Violation[] = [];
    checkNoUncontrolledRetries(trace({ taskId: "t", status: "completed", retryCount: 2, retryingCount: 2, result: { sessionId: "s", status: "completed", strategy: { id: "direct", rung: 0, reason: "" }, turnCount: 0, toolCount: 0, usage: { inputTokens: 0, outputTokens: 0 }, retryCount: 2 } }), v, BUDGET);
    checkNoUncontrolledRetries(trace({ taskId: "t", status: "completed", retryCount: 1, retryingCount: 0, result: { sessionId: "s", status: "completed", strategy: { id: "direct", rung: 0, reason: "" }, turnCount: 0, toolCount: 0, usage: { inputTokens: 0, outputTokens: 0 }, retryCount: 1 } }), v, BUDGET);
    expect(v).toHaveLength(2);
  });

  it("I6 flags SYSTEM_UNKNOWN and missing envelopes, not typed provider failures", () => {
    const v: Violation[] = [];
    checkNoUnexplainedFailures(
      trace({ taskId: "t", status: "failed", result: { sessionId: "s", status: "failed", strategy: { id: "direct", rung: 0, reason: "" }, turnCount: 0, toolCount: 0, usage: { inputTokens: 0, outputTokens: 0 }, retryCount: 0, error: "x", lastError: makeError({ code: "SYSTEM_UNKNOWN", domain: "engine", message: "x" }) } }),
      v,
    );
    checkNoUnexplainedFailures(
      trace({ taskId: "t", status: "failed", result: { sessionId: "s", status: "failed", strategy: { id: "direct", rung: 0, reason: "" }, turnCount: 0, toolCount: 0, usage: { inputTokens: 0, outputTokens: 0 }, retryCount: 0, error: "x" } }),
      v,
    );
    checkNoUnexplainedFailures(
      trace({ taskId: "t", status: "failed", result: { sessionId: "s", status: "failed", strategy: { id: "direct", rung: 0, reason: "" }, turnCount: 0, toolCount: 0, usage: { inputTokens: 0, outputTokens: 0 }, retryCount: 0, error: "x", lastError: makeError({ code: "PROVIDER_RATE_LIMITED", domain: "provider", message: "x", transient: true }) } }),
      v,
    );
    expect(v).toHaveLength(2);
  });

  it("checkInvariants + grouping compose cleanly", () => {
    const traces: RunTrace[] = [
      trace({ taskId: "a", status: "timeout" }),
      trace({ taskId: "b", status: "completed", result: { sessionId: "s", status: "completed", strategy: { id: "direct", rung: 0, reason: "" }, turnCount: 0, toolCount: 0, usage: { inputTokens: 0, outputTokens: 0 }, retryCount: 0 }, terminal: [{ id: "e", executionId: "x", seq: 1, type: "completed", timestamp: new Date() }], projectedStatus: "completed" }),
    ];
    const violations = checkInvariants(traces, BUDGET);
    const by = violationsByInvariant(violations);
    expect(by.get("I1-no-stuck")).toHaveLength(1);
  });
});

describe("harness wiring (real engine + real tools + real store, scripted model)", () => {
  it("runs one task end-to-end and the trace is invariant-clean", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bench-"));
    writeFileSync(join(cwd, "x.ts"), "const answer = 42;\n");

    const engine = benchEngine();
    const task = BENCHMARK_TASKS[0]!;
    const trace = await runBenchmarkTask({
      engine,
      modelChat: scripted([
        turn("reading", [call("readFile", { path: "x.ts" })]),
        turn("found the answer: 42"),
      ]),
      task,
      cwd,
      timeoutMs: 5_000,
    });

    expect(trace.status).toBe("completed");
    expect(trace.projectedStatus).toBe("completed");
    expect(trace.result?.toolCount).toBe(1);
    expect(trace.observed.length).toBe(trace.recorded.length);
    expect(trace.terminal).toHaveLength(1);
    expect(trace.terminal[0]?.type).toBe("completed");
    expect(trace.eventsAfterTerminal).toBe(0);
    expect(trace.seqGaps).toHaveLength(0);

    const violations = checkInvariants([trace], BUDGET);
    expect(violations).toHaveLength(0);
  });

  it("a transient provider failure settles failed with a typed envelope and clean invariants", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bench-"));
    const engine = benchEngine();
    const task = BENCHMARK_TASKS[0]!;
    const trace = await runBenchmarkTask({
      engine,
      modelChat: async () => {
        throw makeError({ code: "PROVIDER_RATE_LIMITED", domain: "provider", message: "429 again", transient: true, retryableAsIs: true });
      },
      task,
      cwd,
      retryBudget: { ...DEFAULT_RETRY_BUDGET, maxAttempts: 2, baseDelayMs: 5, maxDelayMs: 5, jitter: false, backoffMultiplier: 1 },
      timeoutMs: 5_000,
    });

    expect(trace.status).toBe("failed");
    expect(trace.result?.lastError?.code).toBe("PROVIDER_RATE_LIMITED");
    expect(trace.result?.retryCount).toBe(1); // retried once within the budget, then failed
    expect(trace.projectedStatus).toBe("failed");
    expect(trace.retryingCount).toBe(1);

    const violations = checkInvariants([trace], { ...DEFAULT_RETRY_BUDGET, maxAttempts: 2 });
    expect(violations).toHaveLength(0);
  });

  it("manifest is exactly 100 tasks", () => {
    expect(BENCHMARK_TASKS).toHaveLength(100);
    const ids = new Set(BENCHMARK_TASKS.map((t) => t.id));
    expect(ids.size).toBe(100);
  });

  it("rejects a run with neither a real model nor a scripted port", async () => {
    const engine: ExecutionEngine = new ExecutionEngine({ registry: benchEngine().registry });
    await expect(
      runBenchmarkTask({ engine, task: BENCHMARK_TASKS[0]!, cwd: tmpdir(), timeoutMs: 100 } as Parameters<typeof runBenchmarkTask>[0]),
    ).rejects.toThrow(/real model|scripted modelChat/);
  });
});