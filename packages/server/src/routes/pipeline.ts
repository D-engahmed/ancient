// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { jobRunner } from "../lib/job-runner";

// Mirrors CLI detectPackageManager precedence.
const LOCKFILES = [
  { name: "bun", lockfile: "bun.lock" },
  { name: "pnpm", lockfile: "pnpm-lock.yaml" },
  { name: "yarn", lockfile: "yarn.lock" },
  { name: "npm", lockfile: "package-lock.json" },
];

export interface PipelineStageResult {
  script: string;
  ok: boolean;
  output: string;
}

export interface PipelineResult {
  pm: string | null;
  stages: PipelineStageResult[];
}

const DEFAULT_PIPELINE = ["typecheck", "test", "build"];

const startSchema = z.object({
  cwd: z.string().min(1),
  stages: z.array(z.string()).min(1).max(8).default(DEFAULT_PIPELINE),
});

async function detectPm(cwd: string): Promise<string | null> {
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = new Set(await readdir(cwd));
    for (const candidate of LOCKFILES) {
      if (entries.has(candidate.lockfile)) return candidate.name;
    }
    return null;
  } catch {
    return null;
  }
}

async function runStage(
  cwd: string,
  pm: string,
  script: string
): Promise<PipelineStageResult> {
  try {
    const cmd = pm;
    const args = pm === "yarn" ? [script] : ["run", script];
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TERM: "dumb" },
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { script, ok: exitCode === 0, output: `${out}${err}`.slice(0, 4000) };
  } catch (e) {
    return { script, ok: false, output: `Failed to launch: ${String(e)}` };
  }
}

const app = new Hono<AuthenticatedEnv>()
  .post("/", zValidator("json", startSchema), async (c) => {
    const { cwd, stages } = c.req.valid("json");
    const id = jobRunner.enqueue(async () => {
      const pm = await detectPm(cwd);
      if (!pm) {
        return { pm: null, stages: [] } satisfies PipelineResult;
      }
      const stageResults: PipelineStageResult[] = [];
      for (const stage of stages) {
        stageResults.push(await runStage(cwd, pm, stage));
      }
      return { pm, stages: stageResults } satisfies PipelineResult;
    });
    return c.json({ id }, 202);
  })
  .get("/status/:id", async (c) => {
    const id = c.req.param("id");
    const job = jobRunner.get(id);
    if (!job) return c.json({ error: "No such pipeline run" }, 404);
    if (job.status === "succeeded" || job.status === "failed") {
      return c.json({ id, status: job.status, result: job.result, error: job.error });
    }
    return c.json({ id, status: job.status });
  });

export default app;
