// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Server-equivalent tool registry + policy for the benchmark (benchmark/registry).
//
// Mirrors the ExecutionHub's DEFAULT_REGISTRY exactly (packages/server/src/
// executions/hub.ts) so the benchmark exercises the same real capability
// surface the gateway gives users: same tools, same central edge (approval →
// consent → parse → execute → budget → redact). The policy defaults to
// read + write inside the worktree copy; `exec`/`network` are opt-in flags.

import { CapabilityRegistry, type ExecutionScope } from "@ANCIENT/capabilities/core";
import {
  readFileTool,
  listDirectoryTool,
  globTool,
  grepTool,
  writeFileTool,
  editFileTool,
} from "@ANCIENT/capabilities/files";
import { bashTool } from "@ANCIENT/capabilities/shell";
import { listSkillsTool, useSkillTool } from "@ANCIENT/capabilities/skills";
import { fetchUrlTool } from "@ANCIENT/capabilities/browser";
import { ApprovalPolicy, Redactor } from "@ANCIENT/infrastructure/security";

/** The one server-authoritative tool set (F3 parity with ExecutionHub). */
export const BENCHMARK_REGISTRY: CapabilityRegistry = new CapabilityRegistry().registerAll([
  readFileTool,
  listDirectoryTool,
  globTool,
  grepTool,
  writeFileTool,
  editFileTool,
  bashTool,
  listSkillsTool,
  useSkillTool,
  fetchUrlTool,
]);

export type BenchmarkAllow = {
  /** Default true — the worktree copy is disposable. */
  write?: boolean;
  /** Default false — run shell, git, tests etc. only when you mean it. */
  exec?: boolean;
  /** Default false. */
  network?: boolean;
};

/** Approval policy for benchmark runs. Reads always allowed; scope gated on
 *  consent (none here → deny); writes/exec/network per the flags. */
export function benchmarkPolicy(allow: BenchmarkAllow = {}): ApprovalPolicy {
  const policy = new ApprovalPolicy();
  if (allow.write) policy.allow("write");
  if (allow.exec) policy.allow("exec");
  if (allow.network) policy.allow("network");
  return policy;
}

export function benchmarkScope(cwd: string): ExecutionScope {
  return {
    cwd,
    homedir: process.env.HOME ?? process.env.USERPROFILE ?? undefined,
    env: process.env as Record<string, string | undefined>,
  };
}

export const BENCHMARK_REDACTOR = new Redactor();