// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Regression guard for the SSE live-stream contract (GET /:executionId/events):
// the stream must stay OPEN past the replay slice until the engine delivers a
// terminal envelope, then close with that envelope flushed. The old code let
// Hono's stream() close the body the moment the callback returned — after the
// initial `await pump()` drained the replay queue — so any LATER terminal
// (execution.failed with the client-safe error) was silently dropped and the
// CLI saw "no response".

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { ExecutionEventBridge } from "../executions/bridge";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { createExecutionsRoutes } from "./executions";
import type { ExecutionEntry } from "../executions/hub";

const EXECUTION_ID = "EXEC-SSE-REGRESSION";

function buildApp() {
  const bridge = new ExecutionEventBridge();
  bridge.start({ executionId: EXECUTION_ID, task: "regression", mode: "BUILD" });
  // Simulate the engine emitting its "started" lifecycle event: the bridge
  // turns it into strategy.selected (seq 2) + execution.started (seq 3).
  bridge.onLifecycleEvent({
    id: "evt-2",
    executionId: EXECUTION_ID,
    seq: 2,
    type: "started",
    timestamp: new Date(),
    payload: { strategy: "direct", rung: 0, reason: "probe", task: "regression" },
  });
  // Replay slice = {seq:1 execution.created, seq:2 strategy.selected, seq:3 execution.started}.
  expect(bridge.lastSeq).toBe(3);

  const entry: ExecutionEntry = {
    executionId: EXECUTION_ID,
    userId: "user-sse",
    task: "regression",
    mode: "BUILD",
    status: "running",
    session: { cancel: () => undefined, done: Promise.resolve({ status: "failed" }) },
    bridge,
  };
  const stubHub = {
    get: (_userId: string, executionId: string) => (executionId === EXECUTION_ID ? entry : undefined),
    list: () => [entry],
  } as unknown as Parameters<typeof createExecutionsRoutes>[0];
  const routes = createExecutionsRoutes(stubHub);

  const env = new Hono<AuthenticatedEnv>();
  env.use("*", async (c, next) => {
    c.set("userId", "user-sse");
    c.set("traceId", "test-trace");
    await next();
  });
  env.route("/executions", routes);
  return { app: env, bridge };
}

/**
 * Read the SSE body with ONE reader. `wait(needle)` resolves when the needle
 * appears in the accumulated text (stream may still be open) or the body ends
 * (ended=true). Later calls keep reading from where the previous one stopped.
 */
function collectBody(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let ended = false;
  return async (needle: string): Promise<{ text: string; ended: boolean }> => {
    while (!text.includes(needle) && !ended) {
      const { done, value } = await reader.read();
      if (value) text += decoder.decode(value, { stream: true });
      ended = done;
    }
    return { text, ended };
  };
}

describe("GET /executions/:id/events (SSE)", () => {
  test("delivers a terminal emitted AFTER the replay slice, then closes", async () => {
    const { app, bridge } = buildApp();
    const res = await app.request(`/executions/${EXECUTION_ID}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const wait = collectBody(res);

    // The replay slice alone must NOT end the stream — wait for the last
    // buffered frame (execution.started, seq 3) with the body still open.
    const replayed = await wait(`"type":"execution.started"`);
    expect(replayed.ended).toBe(false);
    expect(replayed.text).toContain('"seq":3');

    // Engine delivers the terminal AFTER the replay drained (the old bug).
    bridge.finish("failed", { error: "boom regression" });

    const whole = await wait(`"type":"execution.failed"`);
    expect(whole.text).toContain('"seq":4');
    expect(whole.text).toContain("SYSTEM_UNKNOWN");
    expect(whole.text).toContain("boom regression");

    // The close must follow the terminal envelope — the stream is done.
    const eof = await wait("__never-an-envelope__");
    expect(eof.ended).toBe(true);
  });

  test("not-found on an unknown execution id returns a 404 envelope", async () => {
    const { app } = buildApp();
    const res = await app.request("/executions/i-do-not-exist/events");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("SYSTEM_UNKNOWN");
  });
});