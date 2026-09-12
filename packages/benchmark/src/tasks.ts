// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// The 100-task repository manifest (benchmark). Motion tasks drive the REAL
// engine over a checkout of the ANCIENT monorepo; the harness runs each task's
// text through the real model + tools with `cwd` = the repo root. Paths are
// repo-relative and resolved by the capability tools against Scope.cwd.
//
// The set is deterministic (stable order, stable ids) so a re-run compares
// apples to apples. Tasks exercise the read tools hard (find/grep/read/list/
// compare) plus a small idempotent write corner; exec is deliberately absent —
// a repository-safety benchmark must not mutate the tree under test.

import type { RiskCategory } from "@ANCIENT/infrastructure/security";

export type BenchmarkTask = {
  id: string;
  text: string;
  /** Categories the task is expected to exercise (for the report only). */
  categories: RiskCategory[];
};

/** Repo-relative paths the read/analysis tasks target. Taken from the live
 *  tree so the questions are answerable by the tools, not trivia. */
const READ_FILES = [
  "packages/execution/src/engine.ts",
  "packages/execution/src/model.ts",
  "packages/execution/src/runtime.ts",
  "packages/execution/src/context.ts",
  "packages/execution/src/profiler.ts",
  "packages/execution/src/types.ts",
  "packages/infrastructure/src/storage/store.ts",
  "packages/infrastructure/src/storage/types.ts",
  "packages/infrastructure/src/events/bus.ts",
  "packages/server/src/executions/hub.ts",
  "packages/server/src/executions/bridge.ts",
  "packages/strategies/src/selector.ts",
  "packages/strategies/src/registry.ts",
  "packages/capabilities/src/core/execute.ts",
  "packages/contracts/src/error.ts",
  "packages/reliability/src/retry.ts",
  "packages/server/src/lib/provider-registry.ts",
  "packages/server/src/lib/models.ts",
  "packages/shared/src/models.ts",
  "packages/capabilities/src/core/registry.ts",
  "packages/strategies/src/direct.ts",
  "packages/strategies/src/agent-loop.ts",
  "packages/reliability/src/circuit-breaker.ts",
  "packages/shared/src/execution-events.ts",
  "packages/server/src/index.ts",
  "docs/ARCHITECTURE.md",
] as const;

const READ_DIRS = [
  "packages/execution/src",
  "packages/infrastructure/src",
  "packages/strategies/src",
  "packages/capabilities/src",
  "packages/contracts/src",
  "packages/server/src",
  "packages/reliability/src",
  "docs",
] as const;

const SIGNS = ["export", "export function", "export type", "export const", "export class", "export interface", "export {", "async function", "class Execution", "interface Execution", "const Execution"] as const;

const QUERIES = ["file", "execution", "strategy", "event", "model", "tool", "state", "error", "retry", "projection", "checkpoint", "bridge", "selector", "policy", "capability"] as const;

/** Expand a template over parameters into tasks; used to reach exactly 100. */
function build(): BenchmarkTask[] {
  const tasks: BenchmarkTask[] = [];
  let n = 0;
  const next = (text: string, categories: RiskCategory[]): void => {
    tasks.push({ id: `task-${String(n).padStart(3, "0")}`, text, categories });
    n += 1;
  };

  // 1–26: single-file read + analyze (deterministic template over the pool).
  for (const f of READ_FILES) {
    next(`Read ${f} and summarize what it does in at most 4 sentences. Quote one concrete exported identifier from it.`, ["read"]);
  }

  // 27–34: surface-shape questions per file pool.
  for (const [f, sym] of [["packages/execution/src/engine.ts", "ExecutionEngine"], ["packages/execution/src/engine.ts", "EngineSession"], ["packages/server/src/executions/bridge.ts", "ExecutionEventBridge"], ["packages/server/src/executions/hub.ts", "ExecutionHub"], ["packages/infrastructure/src/events/bus.ts", "MemoryEventBus"], ["packages/capabilities/src/core/execute.ts", "executeTool"], ["packages/contracts/src/error.ts", "makeError"], ["packages/strategies/src/selector.ts", "selectStrategy"]] as const) {
    const file = f;
    next(`Read ${file}. Does it export or define the symbol "${sym}"? Answer with the file, a yes/no verdict, and the closest export/definition line you can find.`, ["read"]);
  }

  // 35–44: grep/scan tasks over directories.
  for (const q of QUERIES.slice(0, 10)) {
    next(`Search the repository for the term "${q}". List up to 5 file:line matches and say which layer each one lives in.`, ["read"]);
  }

  // 45–52: locate-the-definition tasks.
  for (const [q, probe] of [["applyEvent", "packages/infrastructure"], ["inferProfile", "packages/execution"], ["createAiModelChat", "packages/execution"], ["EventSourcedExecutionStore", "packages/infrastructure"], ["ApprovalPolicy", "packages/infrastructure"], ["strategyCatalog", "packages/strategies"], ["isTransientCode", "packages/contracts"], ["redact", "packages/infrastructure"]] as const) {
    next(`Find the definition of "${probe} → ${q}". Give the file path and line number, plus one line of its signature.`, ["read"]);
  }

  // 53–60: compare tasks (read two files, list differences).
  for (const [a, b] of [["packages/execution/src/engine.ts", "packages/execution/src/runtime.ts"], ["packages/infrastructure/src/storage/store.ts", "packages/infrastructure/src/events/bus.ts"], ["packages/strategies/src/registry.ts", "packages/strategies/src/selector.ts"], ["packages/capabilities/src/core/execute.ts", "packages/capabilities/src/core/types.ts"], ["packages/contracts/src/error.ts", "packages/contracts/src/reliability.ts"], ["packages/server/src/executions/hub.ts", "packages/server/src/executions/bridge.ts"], ["packages/execution/src/model.ts", "packages/execution/src/runtime.ts"], ["packages/shared/src/models.ts", "packages/shared/src/experience.ts"]] as const) {
    next(`Compare ${a} and ${b}. List 3 concrete differences in what they export or the role each plays.`, ["read"]);
  }

  // 61–68: directory listings + nesting facts.
  for (let i = 0; i < READ_DIRS.length; i++) {
    const dir = READ_DIRS[i];
    next(`List the files and subdirectories directly inside ${dir} and state how many .ts files it contains.`, ["read"]);
  }

  // 69–76: convention / cross-cutting questions grounded in the tree.
  next("Read the AGENTS.md at the repo root and report the commit-message convention (type/scope format) in one line.", ["read"]);
  next("Find every place that defines a transient retry budget and report file + line for each.", ["read"]);
  next("Search for 'queued' and 'cancelled' in packages/infrastructure/src/storage and list every file:line where they appear.", ["read"]);
  next("Locate the ApprovalPolicy default rules and quote which categories are allow/deny by default.", ["read"]);
  next("Find where the engine publishes a 'completed' lifecycle event and quote the line.", ["read"]);
  next("Locate every file in packages/reliability that exports a retry or circuit-breaker primitive.", ["read"]);
  next("Search for SSRF-related path handling under packages/server/src/lib and summarize the guard in 2 sentences.", ["read"]);
  next("Find the constant DEFAULT_CHAT_MODEL_ID and quote its value with file:line.", ["read"]);

  // 77–90: write corner — idempotent per-run scratch notes (deterministic names).
  const notes = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november"];
  for (let i = 0; i < notes.length; i++) {
    const name = notes[i];
    const content = `benchmark note ${i + 1} - ${name}`;
    next(`Create the file bench-work/${name}.md containing exactly this line: "${content}". If the file already exists, overwrite it with the same line.`, ["write", "read"]);
  }

  // 91–94: retrieve the scratch notes back (round-trip read of writes above).
  for (const name of notes.slice(0, 4)) {
    next(`Read bench-work/${name}.md and state the exact first line it contains.`, ["read"]);
  }

  // 95–100: synthesis tasks pulling several sources.
  next("Read packages/execution/src/engine.ts and packages/infrastructure/src/storage/types.ts and explain in 3 sentences how the engine's terminal states map onto the durable lifecycle stream.", ["read"]);
  next("Search the whole repo for 'STRATEGY_UNRECOVERABLE' and list the file:line of every emitter.", ["read"]);
  next("Read packages/server/src/executions/bridge.ts and list the wire envelope types it emits, quoting the finish() mapping.", ["read"]);
  next("Locate where the cost ledger settles spend on completion under packages/server/src/lib and summarize the flow in 2 sentences.", ["read"]);
  next("Find the tool registry the server hub builds (DEFAULT_REGISTRY) and list all registered tool names in order.", ["read"]);
  next("Summarize docs/ARCHITECTURE.md §2 in 3 sentences and state one explicitly recorded honesty gap.", ["read"]);

  if (tasks.length !== 100) {
    throw new Error(`benchmark manifest built ${tasks.length} tasks, expected exactly 100`);
  }
  return tasks;
}

/** The 100-task manifest, stable order. */
export const BENCHMARK_TASKS: readonly BenchmarkTask[] = build();