// packages/cli/src/lib/experience/runtime.ts
//
// WS-dependent glue that connects the pure experience modules to the real
// filesystem/subprocess environment of the running CLI.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  detectPackageManager,
  parseGitStatus,
  type GitStatusShape,
  type PackageManager,
} from "./repo";
import { LearningStore, loadObservations } from "./learning";

/** Best-effort repo workspace summary shown in the status bar. */
export type WorkspaceInfo = {
  cwd: string;
  packageManager: PackageManager | null;
  git: GitStatusShape | null;
};

export async function getWorkspaceInfo(cwd: string): Promise<WorkspaceInfo> {
  let packageManager: PackageManager | null = null;
  let git: GitStatusShape | null = null;

  try {
    const entries = await readdir(cwd);
    packageManager = detectPackageManager(entries);
  } catch {
    packageManager = null;
  }

  try {
    git = await internalGetGitStatus(cwd);
  } catch {
    git = null;
  }

  return { cwd, packageManager, git };
}

/**
 * Run a git command and return trimmed stdout; null when git is unavailable.
 */
async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TERM: "dumb" },
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output;
  } catch {
    return null;
  }
}

export async function internalGetGitStatus(cwd: string): Promise<GitStatusShape | null> {
  const output = await git(["status", "--short", "--branch"], cwd);
  if (output === null) return null;
  return parseGitStatus(output);
}

/** Run a package-manager pipeline stage and capture success + trimmed output. */
export async function runPipelineStage(
  cwd: string,
  script: string,
  pm: PackageManager
): Promise<{ script: string; ok: boolean; output: string }> {
  try {
    const runArgs = pm.run(script);
    const cmd = runArgs[0]!;
    const args = runArgs.slice(1);
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TERM: "dumb" },
    });
    const outText = await new Response(proc.stdout).text();
    const errText = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return {
      script,
      ok: exitCode === 0,
      output: `${outText}${errText}`.slice(0, 4000),
    };
  } catch (e) {
    return { script, ok: false, output: `Failed to launch: ${String(e)}` };
  }
}

/**
 * Build (or reload) a persisted learning store rooted at `baseDir` (e.g.
 * `join(process.env.HOME ?? "", ".ancient", "learn", "observations.json")`).
 */
export async function openLearningStore(filePath: string): Promise<LearningStore> {
  const store = new LearningStore();
  const observations = await loadObservations(filePath);
  store.recordMany(observations);
  return store;
}

/** Convenience default path for the learning store. */
export function defaultLearningFile(cwd: string): string {
  return join(cwd, ".ancient", "learn", "observations.json");
}
