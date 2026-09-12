// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// The six execution reliability invariants (benchmark/invariants) — the Phase A
// exit criterion. Each function is a pure, single-run check so the whole suite
// can be unit-tested over both real and scripted traces. A benchmark passes when
// every trace produces zero violations.
//
//   I1  no-stuck            every run settles within its wall-clock budget
//   I2  no-fake-completions a completed run really completed (output/terminal)
//   I3  no-lost-streams     the observe channel saw exactly the engine's events
//   I4  no-corrupted-state  durable projection == terminal result, gapless seq
//   I5  no-uncontrolled-retries retries bounded by the budget, retrying counts
//   I6  no-unexplained-failures failures carry the closed taxonomy, never blank
//
// These are the six failure modes Phase A exists to kill (stuck, fake, lost,
// corrupted, uncontrolled, unexplained) made checkable over a RunTrace.

import { ERROR_CODES } from "@ANCIENT/contracts";
import type { RetryBudget } from "@ANCIENT/contracts";
import type { RunTrace } from "./harness";

export type Violation = {
  invariant: string;
  taskId: string;
  detail: string;
};

const TERMINAL = { completed: "completed", failed: "failed", cancelled: "cancelled" } as const;

/** The quality-gate note the engine synthesizes when tools ran but no final
 *  text was produced — such a run is still a legitimate (non-fake) completion. */
const SYNTHESIZED_NOTE = /^I ran \d+ tool call/;

/** I1 — a session must always settle; a hang (timeout) or a crashed harness
 *  run is the exact failure this benchmark exists to catch. */
export function checkNoStuck(trace: RunTrace, violations: Violation[]): void {
  if (trace.status === "timeout") {
    violations.push({ invariant: "I1-no-stuck", taskId: trace.taskId, detail: `session did not settle within ${trace.timeoutMs}ms` });
  }
  if (trace.status === "orchestration-error") {
    violations.push({ invariant: "I1-no-stuck", taskId: trace.taskId, detail: "harness lost the run before/while awaiting settle" });
  }
}

/** I2 — a completed run must not be fake: never an empty answer after tools,
 *  never completely silent text, never a doubled/mismatched terminal event. */
export function checkNoFakeCompletions(trace: RunTrace, violations: Violation[]): void {
  if (trace.status !== "completed") return;

  const result = trace.result;
  if (!result) {
    violations.push({ invariant: "I2-no-fake-completions", taskId: trace.taskId, detail: "completed run with no engine result" });
    return;
  }
  const output = result.output?.trim() ?? "";
  if (result.toolCount > 0 && output.length === 0) {
    violations.push({ invariant: "I2-no-fake-completions", taskId: trace.taskId, detail: "tools ran but the final answer is empty" });
  }
  if (output.length === 0 && !result.summary?.trim()) {
    violations.push({ invariant: "I2-no-fake-completions", taskId: trace.taskId, detail: "silent blank completion (no output, no summary)" });
  }

  if (trace.terminal.length !== 1) {
    violations.push({ invariant: "I2-no-fake-completions", taskId: trace.taskId, detail: `expected exactly 1 terminal lifecycle event, saw ${trace.terminal.length}` });
    return;
  }
}

/** I3 — the gateway stream (`observe`) must see exactly what the engine
 *  recorded, and the final output must match what deltas rendered. */
export function checkNoLostStreams(trace: RunTrace, violations: Violation[]): void {
  if (trace.observed.length !== trace.recorded.length) {
    violations.push({ invariant: "I3-no-lost-streams", taskId: trace.taskId, detail: `observe saw ${trace.observed.length} events but the engine recorded ${trace.recorded.length}` });
  }
  for (let i = 0; i < Math.min(trace.observed.length, trace.recorded.length); i++) {
    if (trace.observed[i]!.type !== trace.recorded[i]!.type) {
      violations.push({ invariant: "I3-no-lost-streams", taskId: trace.taskId, detail: `event #${i} diverges: observed=${trace.observed[i]!.type} recorded=${trace.recorded[i]!.type}` });
      break;
    }
  }
  if (trace.observedDeltas !== trace.recordedDeltas) {
    violations.push({ invariant: "I3-no-lost-streams", taskId: trace.taskId, detail: `text deltas diverged (observed ${trace.observedDeltas.length} chars vs recorded ${trace.recordedDeltas.length})` });
  }
  if (trace.status === "completed" && trace.recordedDeltas.length > 0 && trace.result) {
    const output = trace.result.output ?? "";
    const deltaPrefix = output.startsWith(trace.recordedDeltas);
    const qualityGate = SYNTHESIZED_NOTE.test(output);
    if (!deltaPrefix && !qualityGate && output !== trace.recordedDeltas) {
      violations.push({ invariant: "I3-no-lost-streams", taskId: trace.taskId, detail: `final output (${output.length} chars) does not contain the streamed deltas (${trace.recordedDeltas.length} chars)` });
    }
  }
}

/** I4 — replaying the durable log must reproduce the terminal result: gapless
 *  seq, monotonic timestamps, no events after the terminal one. */
export function checkNoCorruptedState(trace: RunTrace, violations: Violation[]): void {
  if (trace.status === "completed" || trace.status === "failed" || trace.status === "cancelled") {
    if (trace.projectedStatus !== trace.result?.status) {
      violations.push({ invariant: "I4-no-corrupted-state", taskId: trace.taskId, detail: `durable projection is '${trace.projectedStatus ?? "none"}' but the engine terminal status is '${trace.result?.status}'` });
    }
  }
  if (trace.seqGaps.length > 0) {
    violations.push({ invariant: "I4-no-corrupted-state", taskId: trace.taskId, detail: `broken gapless seq at values ${trace.seqGaps.slice(0, 5).join(",")}` });
  }
  if (trace.timestampInversions > 0) {
    violations.push({ invariant: "I4-no-corrupted-state", taskId: trace.taskId, detail: `${trace.timestampInversions} lifecycle event(s) with non-monotonic timestamps` });
  }
  if (trace.eventsAfterTerminal > 0) {
    violations.push({ invariant: "I4-no-corrupted-state", taskId: trace.taskId, detail: `${trace.eventsAfterTerminal} lifecycle event(s) published after the terminal one` });
  }
}

/** I5 — retries are bounded by the budget and every retry is on the record;
 *  escalation is bounded by the re-selection limit (RESELECTION_LIMIT). */
export function checkNoUncontrolledRetries(trace: RunTrace, violations: Violation[], budget: RetryBudget): void {
  const maxRetries = Math.max(0, budget.maxAttempts - 1);
  if (trace.retryCount > maxRetries) {
    violations.push({ invariant: "I5-no-uncontrolled-retries", taskId: trace.taskId, detail: `retried ${trace.retryCount} times, budget allows ${maxRetries}` });
  }
  if (trace.retryingCount !== trace.retryCount) {
    violations.push({ invariant: "I5-no-uncontrolled-retries", taskId: trace.taskId, detail: `retrying events (${trace.retryingCount}) mismatch engine retryCount (${trace.retryCount})` });
  }
  if (trace.degradeCount > 1) {
    violations.push({ invariant: "I5-no-uncontrolled-retries", taskId: trace.taskId, detail: `escalated ${trace.degradeCount} times (RESELECTION_LIMIT is 1)` });
  }
}

/** I6 — a failure must be typed with a closed-taxonomy code and a message;
 *  SYSTEM_UNKNOWN and missing envelopes are incidents, not normal outcomes. */
export function checkNoUnexplainedFailures(trace: RunTrace, violations: Violation[]): void {
  if (trace.status === "cancelled") {
    if (!trace.result?.error) {
      violations.push({ invariant: "I6-no-unexplained-failures", taskId: trace.taskId, detail: "cancelled run carries no reason" });
    }
    return;
  }
  if (trace.status !== "failed") return;

  const result = trace.result;
  if (!result?.lastError) {
    violations.push({ invariant: "I6-no-unexplained-failures", taskId: trace.taskId, detail: `failed run without a typed error envelope (${result?.error ?? "no message"})` });
    return;
  }
  const { code, message } = result.lastError;
  if (!code || !ERROR_CODES.includes(code)) {
    violations.push({ invariant: "I6-no-unexplained-failures", taskId: trace.taskId, detail: `failure code '${code}' is outside the closed taxonomy` });
  }
  if (code === "SYSTEM_UNKNOWN") {
    violations.push({ invariant: "I6-no-unexplained-failures", taskId: trace.taskId, detail: "SYSTEM_UNKNOWN — the last-resort code must not occur in steady state" });
  }
  if (!message) {
    violations.push({ invariant: "I6-no-unexplained-failures", taskId: trace.taskId, detail: "failure envelope carries no message" });
  }
}

/** Run all six checks over traces; returns every violation found. */
export function checkInvariants(traces: readonly RunTrace[], budget: RetryBudget): Violation[] {
  const violations: Violation[] = [];
  for (const trace of traces) {
    checkNoStuck(trace, violations);
    checkNoFakeCompletions(trace, violations);
    checkNoLostStreams(trace, violations);
    checkNoCorruptedState(trace, violations);
    checkNoUncontrolledRetries(trace, violations, budget);
    checkNoUnexplainedFailures(trace, violations);
  }
  return violations;
}

/** Group violations by invariant for the report. */
export function violationsByInvariant(violations: readonly Violation[]): Map<string, Violation[]> {
  const by = new Map<string, Violation[]>();
  for (const v of violations) {
    const list = by.get(v.invariant) ?? [];
    list.push(v);
    by.set(v.invariant, list);
  }
  return by;
}

export { TERMINAL as TERMINAL_LIFECYCLE };