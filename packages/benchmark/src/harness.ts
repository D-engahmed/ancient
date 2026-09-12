// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Benchmark harness (benchmark/harness) — runs ONE task through the REAL
// execution path:
//
//   ExecutionEngine (real) → StrategyRuntime (real) → capability registry (real)
//   → model chat port (real provider)  |  lifecycle bus (real MemoryEventBus)
//   → durable store replay (real EventSourcedExecutionStore)  |  observe channel
//
// and captures a structured RunTrace the invariant checks consume. The only
// mocked thing anywhere in the stack is whatever the operator substitutes for
// the model — the default path resolves a real LanguageModel.
//
// Every engine emission is captured on two independent channels — the bus and
// the `observe` callback — so the trace can prove "the gateway saw exactly what
// the engine produced" (no lost streams) and "the durable projection equals the
// terminal result" (no corrupted state).

import { ExecutionEngine, createAiModelChat, type ExecutionSession, type ModelChat, type RunResult } from "@ANCIENT/execution";
import { DEFAULT_RETRY_BUDGET, RESELECTION_LIMIT } from "@ANCIENT/execution/runner";
import type { RetryBudget } from "@ANCIENT/contracts";
import { MemoryEventBus, type LifecycleEvent } from "@ANCIENT/infrastructure/events";
import { EventSourcedExecutionStore } from "@ANCIENT/infrastructure/storage";
import type { RiskCategory } from "@ANCIENT/infrastructure/security";
import type { StrategyEvent } from "@ANCIENT/strategies";
import type { LanguageModel } from "ai";
import type { BenchmarkTask } from "./tasks";
import { benchmarkPolicy, benchmarkScope, BENCHMARK_REDACTOR, BENCHMARK_REGISTRY, type BenchmarkAllow } from "./registry";

export type RunOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout"
  | "orchestration-error";

/** A settled-or-crash record for one benchmark task, ready for invariant checks. */
export type RunTrace = {
  taskId: string;
  task: string;
  categories: readonly RiskCategory[];
  status: RunOutcome;
  durationMs: number;
  /** Terminal run result, when the engine settled it. */
  result?: RunResult;
  /** Every lifecycle event the engine published, in bus order. */
  lifecycle: readonly LifecycleEvent[];
  /** Terminal lifecycle events (completed/failed/cancelled) — must be exactly one, last. */
  terminal: readonly LifecycleEvent[];
  /** Events observed on the `observe` channel (the gateway's stream). */
  observed: readonly StrategyEvent[];
  /** Events the session recorded (session.events()). */
  recorded: readonly StrategyEvent[];
  /** Durable projection status from the store replay, when derivable. */
  projectedStatus?: string;
  /** Lifecycle seq values that broke the gapless 1-based rule (empty = clean). */
  seqGaps: readonly number[];
  /** How many lifecycle events show non-monotonic timestamps. */
  timestampInversions: number;
  /** Lifecycle events that arrived after the terminal event. */
  eventsAfterTerminal: number;
  /** Concatenated text deltas as recorded (session) and observed (gateway). */
  recordedDeltas: string;
  observedDeltas: string;
  retryCount: number;
  retryingCount: number;
  degradeCount: number;
  timeoutMs: number;
};

class TimeoutError extends Error {}

/** Wait for a settle with a wall-clock deadline; rejects with TimeoutError. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`settle exceeded ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export type RunBenchmarkTaskOptions = {
  engine: ExecutionEngine;
  /** The REAL LanguageModel (or a scripted one in tests). */
  model?: LanguageModel;
  /** Direct ModelChat port override — tests script a model here and skip the
   *  SDK, the benchmark CLI relies on the real `model` above. */
  modelChat?: ModelChat;
  task: BenchmarkTask;
  /** The repo checkout root all tool paths resolve against. */
  cwd: string;
  allow?: BenchmarkAllow;
  timeoutMs?: number;
  retryBudget?: RetryBudget;
};

export async function runBenchmarkTask(opts: RunBenchmarkTaskOptions): Promise<RunTrace> {
  const { engine, task, cwd, allow, timeoutMs = 5 * 60_000 } = opts;
  if (!opts.model && !opts.modelChat) {
    throw new Error("runBenchmarkTask: provide a real model (LanguageModel) or a scripted modelChat port");
  }
  const modelChat = opts.modelChat ?? createAiModelChat(opts.model!);
  const retryBudget = opts.retryBudget ?? { ...DEFAULT_RETRY_BUDGET, maxAttempts: Math.max(2, DEFAULT_RETRY_BUDGET.maxAttempts) };
  const executionId = `bench-${task.id}`;
  const bus = new MemoryEventBus();

  // Channel 1: every lifecycle event, with gapless/ordering bookkeeping done
  // in-place (the bus is synchronous, so this is an honest total order).
  const lifecycle: LifecycleEvent[] = [];
  const seqGaps: number[] = [];
  let expectedSeq = 1;
  let lastTs = 0;
  let timestampInversions = 0;
  let lastTerminalIndex = -1;
  const TERMINAL_TYPES = new Set<LifecycleEvent["type"]>(["completed", "failed", "cancelled"]);
  bus.subscribe((e) => {
    if (e.seq !== expectedSeq) seqGaps.push(e.seq);
    expectedSeq += 1;
    const ts = e.timestamp.getTime();
    if (ts < lastTs) timestampInversions += 1;
    lastTs = ts;
    if (TERMINAL_TYPES.has(e.type)) lastTerminalIndex = lifecycle.length;
    lifecycle.push(e);
  });

  // Channel 2: the durable append-only log (replayed to a projection after).
  const store = new EventSourcedExecutionStore();
  bus.subscribe((e) => void store.appendEvent(e));

  const observed: StrategyEvent[] = [];
  const startedAt = Date.now();
  let session: ExecutionSession | undefined;
  let result: RunResult | undefined;
  let status: RunOutcome;

  try {
    session = engine.run({
      sessionId: executionId,
      task: task.text,
      scope: benchmarkScope(cwd),
      policy: benchmarkPolicy(allow),
      model: modelChat,
      mode: "BUILD",
      redactor: BENCHMARK_REDACTOR,
      observe: (e) => observed.push(e),
      bus,
      retryBudget,
    });
    result = await withTimeout(session.done, timeoutMs);
    status = result.status;
  } catch (err) {
    status = err instanceof TimeoutError ? "timeout" : "orchestration-error";
  }
  const durationMs = Date.now() - startedAt;

  let projectedStatus: string | undefined;
  try {
    const record = await store.getExecution(executionId);
    projectedStatus = record?.status;
  } catch {
    projectedStatus = undefined;
  }

  const recorded = session?.events() ?? [];
  const recordedDeltas = recorded
    .filter((e): e is Extract<StrategyEvent, { type: "text-delta" }> => e.type === "text-delta")
    .map((e) => e.text)
    .join("");
  const observedDeltas = observed
    .filter((e): e is Extract<StrategyEvent, { type: "text-delta" }> => e.type === "text-delta")
    .map((e) => e.text)
    .join("");
  const terminal = lifecycle.filter((e) => TERMINAL_TYPES.has(e.type));

  return {
    taskId: task.id,
    task: task.text,
    categories: task.categories,
    status,
    durationMs,
    result,
    lifecycle,
    terminal,
    observed,
    recorded,
    projectedStatus,
    seqGaps,
    timestampInversions,
    eventsAfterTerminal: lastTerminalIndex === -1 ? 0 : lifecycle.length - 1 - lastTerminalIndex,
    recordedDeltas,
    observedDeltas,
    retryCount: result?.retryCount ?? 0,
    retryingCount: lifecycle.filter((e) => e.type === "retrying").length,
    degradeCount: lifecycle.filter((e) => e.type === "degraded").length,
    timeoutMs,
  };
}

export { DEFAULT_RETRY_BUDGET, RESELECTION_LIMIT };

/** Rebuild the REAL engine exactly once per benchmark run and reuse it. */
export function benchEngine(): ExecutionEngine {
  return new ExecutionEngine({ registry: BENCHMARK_REGISTRY });
}

export type { BenchmarkAllow };