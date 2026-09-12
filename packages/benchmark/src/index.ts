// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Benchmark CLI — package/benchmark.
//
//   bun run benchmark --repo <worktree> [--tasks 100] [--model gpt-5.6-sol]
//                     [--allow write,exec] [--timeout-ms 300000]
//                     [--max-attempts 2] [--out result.json] [--probe task-000]
//
// Drives the real ExecutionEngine over the real strategy catalog, the real
// server tool registry, and a real model (provider key required), asserts the
// six invariants, and exits 0 only when every run is clean. Run against a
// WORKTREE copy of the repository, never the live tree.

import { config as loadEnv } from "dotenv";
import { resolve as resolvePath } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DEFAULT_RETRY_BUDGET } from "@ANCIENT/execution/runner";
import { BENCHMARK_TASKS } from "./tasks";
import { runBenchmarkTask, benchEngine, type RunTrace } from "./harness";
import { checkInvariants, violationsByInvariant } from "./invariants";
import { resolveBenchmarkModel } from "./model";

type CliArgs = {
  repo: string;
  tasks: number;
  offset: number;
  model: string | undefined;
  allow: string[];
  timeoutMs: number;
  maxAttempts: number;
  out: string | undefined;
  probe: string | undefined;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    repo: process.cwd(),
    tasks: BENCHMARK_TASKS.length,
    offset: 0,
    model: undefined,
    allow: [],
    timeoutMs: 300_000,
    maxAttempts: DEFAULT_RETRY_BUDGET.maxAttempts,
    out: undefined,
    probe: undefined,
  };
  for (const raw of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
    if (!match) continue;
    const key = match[1]!;
    const value = match[2];
    switch (key) {
      case "repo":
        if (value) args.repo = value;
        break;
      case "tasks":
        args.tasks = Number(value ?? 1);
        break;
      case "offset":
        args.offset = Number(value ?? 0);
        break;
      case "model":
        args.model = value;
        break;
      case "allow":
        args.allow = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "timeout-ms":
        args.timeoutMs = Number(value ?? 300_000);
        break;
      case "max-attempts":
        args.maxAttempts = Number(value ?? 2);
        break;
      case "out":
        args.out = value;
        break;
      case "probe":
        args.probe = value;
        break;
    }
  }
  return args;
}

function dirtyCheck(repo: string): void {
  if (!existsSync(resolvePath(repo, ".git"))) return;
  let dirty = "";
  try {
    dirty = execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    dirty = "";
  }
  if (dirty.trim()) console.warn(`! warning: ${repo} has uncommitted changes — run the benchmark on a clean worktree copy.`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();
  loadEnv({ path: resolvePath(args.repo, ".env"), quiet: true });

  const repo = resolvePath(args.repo);
  if (!existsSync(repo)) {
    console.error(`benchmark: repository '${repo}' does not exist`);
    process.exit(2);
  }
  dirtyCheck(repo);

  let modelId: string;
  let provider: string;
  try {
    const resolved = resolveBenchmarkModel(args.model);
    modelId = resolved.modelId;
    provider = resolved.provider;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const slice = BENCHMARK_TASKS.slice(args.offset, args.offset + args.tasks);
  if (slice.length === 0) {
    console.error(`benchmark: no tasks in offset=${args.offset} count=${args.tasks} (manifest has ${BENCHMARK_TASKS.length})`);
    process.exit(2);
  }

  const allow = { write: args.allow.includes("write"), exec: args.allow.includes("exec"), network: args.allow.includes("network") };
  const retryBudget = { ...DEFAULT_RETRY_BUDGET, maxAttempts: args.maxAttempts };
  const engine = benchEngine();
  const model = resolveBenchmarkModel(modelId).model;

  console.log(`benchmark: model=${modelId} (${provider}) repo=${repo} tasks=${slice.length} timeout=${args.timeoutMs}ms retryBudget.maxAttempts=${retryBudget.maxAttempts} allow=${Object.entries(allow).filter(([, v]) => v).map(([k]) => k).join(",") || "read"}`);

  if (args.probe) {
    const task = slice.find((t) => t.id === args.probe) ?? slice[0]!;
    const trace = await runBenchmarkTask({ engine, model, task, cwd: repo, allow, timeoutMs: args.timeoutMs, retryBudget });
    printTrace(task.id, trace);
    process.exit(0);
  }

  const traces: RunTrace[] = [];
  const startedAt = Date.now();
  for (let i = 0; i < slice.length; i++) {
    const task = slice[i]!;
    const trace = await runBenchmarkTask({ engine, model, task, cwd: repo, allow, timeoutMs: args.timeoutMs, retryBudget });
    traces.push(trace);
    console.log(`  [${String(i + 1).padStart(3)}/${slice.length}] ${task.id} → ${trace.status.padEnd(12)} ${(trace.durationMs / 1000).toFixed(1)}s`);
  }
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  const violations = checkInvariants(traces, retryBudget);
  const byInvariant = violationsByInvariant(violations);

  console.log("\n=== invariant results ===");
  const INVARIANT_LABELS: Record<string, string> = {
    "I1-no-stuck": "I1 no stuck",
    "I2-no-fake-completions": "I2 no fake completions",
    "I3-no-lost-streams": "I3 no lost streams",
    "I4-no-corrupted-state": "I4 no corrupted state",
    "I5-no-uncontrolled-retries": "I5 no uncontrolled retries",
    "I6-no-unexplained-failures": "I6 no unexplained failures",
  };
  for (const [invariant, label] of Object.entries(INVARIANT_LABELS)) {
    const list = byInvariant.get(invariant) ?? [];
    const mark = list.length === 0 ? "PASS" : "FAIL";
    console.log(`  ${mark} ${label.padEnd(28)} (${list.length})`);
    for (const v of list.slice(0, 5)) console.log(`        ${v.taskId}: ${v.detail}`);
    if (list.length > 5) console.log(`        … +${list.length - 5} more`);
  }

  const outcomes = new Map<string, number>();
  for (const t of traces) outcomes.set(t.status, (outcomes.get(t.status) ?? 0) + 1);

  console.log(`\n=== outcomes (${traces.length} tasks, ${elapsedSec}s) ===`);
  for (const [status, count] of [...outcomes.entries()].sort()) console.log(`  ${status.padEnd(14)} ${count}`);

  if (args.out) {
    const payload = {
      generatedAt: new Date().toISOString(),
      model: modelId,
      repo,
      retryBudget,
      summary: { traces: traces.length, violations: violations.length, outcomes: Object.fromEntries(outcomes) },
      violations,
      traces: traces.map((t) => ({
        taskId: t.taskId,
        status: t.status,
        durationMs: t.durationMs,
        projectedStatus: t.projectedStatus,
        seqGaps: t.seqGaps,
        eventsAfterTerminal: t.eventsAfterTerminal,
        recordedDeltasLength: t.recordedDeltas.length,
        observedDeltasLength: t.observedDeltas.length,
        retryCount: t.retryCount,
        errorCode: t.result?.lastError?.code,
        error: t.result?.error,
      })),
    };
    writeFileSync(args.out, JSON.stringify(payload, null, 2));
    console.log(`\nresults written to ${args.out}`);
  }

  process.exit(violations.length === 0 ? 0 : 1);
}

function printTrace(taskId: string, trace: RunTrace): void {
  console.log(`\n=== probe ${taskId} ===`);
  console.log(`status: ${trace.status} (${trace.durationMs}ms)`);
  console.log(`projectedStatus: ${trace.projectedStatus ?? "none"}`);
  console.log(`retryCount: ${trace.retryCount}  retrying events: ${trace.retryingCount}  degrade: ${trace.degradeCount}`);
  console.log(`seqGaps: ${trace.seqGaps.length}  timestampInversions: ${trace.timestampInversions}  eventsAfterTerminal: ${trace.eventsAfterTerminal}`);
  console.log(`observed: ${trace.observed.length} strategy events, recorded: ${trace.recorded.length}`);
  console.log(`recordedDeltas: ${trace.recordedDeltas.length} chars, observedDeltas: ${trace.observedDeltas.length} chars`);
  if (trace.result?.output) console.log(`\noutput: ${trace.result.output.slice(0, 400)}`);
  if (trace.result?.error) console.log(`error: ${trace.result.error}`);
  if (trace.result?.lastError) console.log(`lastError: ${trace.result.lastError.code} (${trace.result.lastError.domain}) ${trace.result.lastError.message}`);
}

void main();