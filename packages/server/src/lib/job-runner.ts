// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

// Generic in-memory background job registry. Lets the server start a heavy
// task, return a job id immediately, and let the caller poll for completion —
// the "background processing" primitive for the CLI experience (e.g. CI/CD
// pipeline runs, long compactions).

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type BackgroundJob = {
  id: string;
  status: JobStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  result?: unknown;
  error?: string;
};

type JobDescriptor = {
  id: string;
  run: () => Promise<unknown>;
};

export class JobRunner {
  private jobs = new Map<string, BackgroundJob>();
  private queue: JobDescriptor[] = [];
  private active = false;
  private idCounter = 0;

  /** Enqueue a job and return its id immediately. */
  enqueue(run: () => Promise<unknown>): string {
    const id = `job-${++this.idCounter}`;
    this.jobs.set(id, {
      id,
      status: "queued",
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
    });
    this.queue.push({ id, run });
    void this.drain();
    return id;
  }

  get(id: string): BackgroundJob | undefined {
    return this.jobs.get(id);
  }

  private async drain(): Promise<void> {
    if (this.active) return;
    this.active = true;
    while (this.queue.length > 0) {
      const descriptor = this.queue.shift()!;
      const job = this.jobs.get(descriptor.id)!;
      job.status = "running";
      job.startedAt = Date.now();
      try {
        job.result = await descriptor.run();
        job.status = "succeeded";
      } catch (e) {
        job.status = "failed";
        job.error = e instanceof Error ? e.message : String(e);
      } finally {
        job.finishedAt = Date.now();
      }
    }
    this.active = false;
  }
}

// Shared instance for the whole server process.
export const jobRunner = new JobRunner();
