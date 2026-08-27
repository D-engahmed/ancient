import { test, expect } from "bun:test";
import { JobRunner } from "./job-runner";

test("enqueue returns an id and the job reaches succeeded", async () => {
  const runner = new JobRunner();
  const id = runner.enqueue(async () => "done");
  expect(id).toStartWith("job-");

  await waitFor(() => runner.get(id)!.status === "succeeded" || runner.get(id)!.status === "failed");
  const job = runner.get(id)!;
  expect(job.status).toBe("succeeded");
  expect(job.result).toBe("done");
  expect(job.finishedAt).not.toBeNull();
});

test("failed jobs capture the error message", async () => {
  const runner = new JobRunner();
  const id = runner.enqueue(async () => {
    throw new Error("boom");
  });
  await waitFor(() => runner.get(id)!.status !== "running");
  const job = runner.get(id)!;
  expect(job.status).toBe("failed");
  expect(job.error).toBe("boom");
});

test("jobs run sequentially in FIFO order", async () => {
  const runner = new JobRunner();
  const order: string[] = [];
  runner.enqueue(async () => { order.push("a"); await sleep(5); });
  runner.enqueue(async () => { order.push("b"); await sleep(1); });
  await waitFor(() => order.length === 2);
  expect(order).toEqual(["a", "b"]);
});

test("get returns undefined for unknown ids", () => {
  const runner = new JobRunner();
  expect(runner.get("nope")).toBeUndefined();
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(cond: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await sleep(1);
  }
}
