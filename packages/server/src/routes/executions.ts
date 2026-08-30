// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Gateway execution surface (CLI-V2 Phase 5, contracts C6/C8).
//
//   POST /executions                       start an execution
//   GET  /executions                       list the caller's executions
//   GET  /executions/:id                   status snapshot
//   GET  /executions/:id/events?lastEventId=N   SSE replay + live stream
//   POST /executions/:id/cancel            request cancellation
//   POST /executions/:id/pause|resume      409 — not supported by the engine yet
//
// Every response touches EXACTLY the typed wire contract in @ANCIENT/shared;
// the CLI consumes these envelopes, never engine internals (AUDIT → Phase 6).
// SSE: qapless-seq envelopes framed as `id: <seq>`, `Last-Event-ID` replay.

import { Hono } from "hono";
import { stream } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  chatModelSelectionSchema,
  modeSchema,
  type ExecutionEventEnvelope,
} from "@ANCIENT/shared";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { guardJson } from "../lib/error-mapper";
import { ExecutionHub, type ExecutionEntry } from "../executions/hub";

const executionRequestSchema = z.object({
  task: z.string().min(1).max(100_000),
  mode: modeSchema.optional(),
  model: chatModelSelectionSchema.optional(),
  cwd: z.string().min(1).optional(),
  allow: z.array(z.enum(["read", "write", "exec", "network", "scope"])).optional(),
  toolAllow: z.array(z.string()).optional(),
});
type ExecutionRequest = z.infer<typeof executionRequestSchema>;

const cancelSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

export function createExecutionsRoutes(hub: ExecutionHub) {
  const app = new Hono<AuthenticatedEnv>();

  function snapshot(entry: ExecutionEntry) {
    return {
      executionId: entry.executionId,
      status: entry.status,
      task: entry.task,
      mode: entry.mode,
      userId: entry.userId,
      modelRef: entry.modelRef,
      lastSeq: entry.bridge.lastSeq,
      terminal: entry.bridge.closed,
    };
  }

  app.post("/", zValidator("json", executionRequestSchema), async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json") as ExecutionRequest;
    const entry = await hub.start({
      userId,
      task: body.task,
      mode: body.mode,
      model: body.model,
      cwd: body.cwd,
      allow: body.allow,
      toolAllow: body.toolAllow,
    });
    return c.json(
      {
        executionId: entry.executionId,
        status: entry.status,
        task: entry.task,
        mode: entry.mode,
        modelRef: entry.modelRef,
        lastSeq: entry.bridge.lastSeq,
      },
      202,
    );
  });

  app.get("/", async (c) => {
    const userId = c.get("userId");
    return c.json({ executions: hub.list(userId).map(snapshot) });
  });

  app.get("/:executionId", async (c) => {
    const userId = c.get("userId");
    const entry = hub.get(userId, c.req.param("executionId"));
    if (!entry) return guardJson(c, "Execution not found", 404);
    return c.json(snapshot(entry));
  });

  app.post("/:executionId/cancel", zValidator("json", cancelSchema), (c) => {
    const userId = c.get("userId");
    const reason = c.req.valid("json").reason;
    const entry = hub.cancel(userId, c.req.param("executionId"), reason);
    if (!entry) return guardJson(c, "Execution not found", 404);
    return c.json({ executionId: entry.executionId, status: "cancelled" });
  });

  // Consent response (Phase 9): the CLI sends approve/deny for a pending approval.requested.
  const consentSchema = z.object({
    requestId: z.string().min(1),
    granted: z.boolean(),
  });

  app.post("/:executionId/consent", zValidator("json", consentSchema), (c) => {
    const userId = c.get("userId");
    const executionId = c.req.param("executionId");
    const { requestId, granted } = c.req.valid("json");
    const accepted = hub.respondToConsent(userId, executionId, requestId, granted);
    if (!accepted) return guardJson(c, "Unknown or expired consent request", 404);
    return c.json({ requestId, granted, executionId });
  });

  // Honest stubs: the engine exposes cancellation only today (AUDIT F2/F5);
  // pause/resume arrive with the durable execution-store bridge.
  for (const verb of ["pause", "resume"] as const) {
    app.post(`/:executionId/${verb}`, (c) => {
      const userId = c.get("userId");
      const entry = hub.get(userId, c.req.param("executionId"));
      if (!entry) return guardJson(c, "Execution not found", 404);
      return guardJson(c, `${verb} is not supported by the engine yet — only cancel is wired.`, 409);
    });
  }

  /**
   * SSE event stream. Honors RFC 2426 `Last-Event-ID` (header or query param):
   * replays buffered envelopes with `seq > lastEventId`, then stays live until
   * a terminal envelope is flushed (then the stream closes). Heartbeat comment
   * every 25s keeps idle proxies honest.
   *
   * CRITICAL: the stream callback must NOT resolve until the terminal envelope
   * has actually been written. Hono's `stream()` runs its callback and calls
   * `stream.close()` in a `finally` when the callback RETURNS. The old code
   * `await pump()`-ed only the initial replay slice, so once that drained the
   * callback returned, the body closed, and every later engine emission (the
   * `execution.failed` that carries the CLIENT-SAFE ERROR) was silently dropped
   * — the CLI saw the stream end after `execution.started` and never got a
   * terminal, i.e. "no response". `done` below keeps the callback alive.
   */
  app.get("/:executionId/events", async (c) => {
    const userId = c.get("userId");
    const entry = hub.get(userId, c.req.param("executionId"));
    if (!entry) return guardJson(c, "Execution not found", 404);

    const raw = c.req.header("Last-Event-ID") ?? c.req.query("lastEventId") ?? "0";
    const from = Math.max(0, Number.parseInt(raw, 10) || 0);

    const queue: ExecutionEventEnvelope[] = [];
    let listener: ((e: ExecutionEventEnvelope) => void) | undefined;
    let closed = false;
    let pumping = false;

    const frame = (e: ExecutionEventEnvelope) =>
      `id: ${e.seq}\nevent: execution\ndata: ${JSON.stringify(e)}\n\n`;

    return stream(c, async (stream) => {
      let resolveDone: () => void = () => undefined;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });

      // Subscribe first, then prime the queue from the buffer — both within
      // one synchronous block, so no engine emission can slip between them.
      listener = (e) => {
        queue.push(e);
        runPump();
      };
      entry.bridge.subscribe(listener);
      for (const e of entry.bridge.snapshot(from)) queue.push(e);

      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");
      c.header("X-Accel-Buffering", "no");
      c.header("Content-Type", "text/event-stream");

      const heartbeat = setInterval(() => {
        void stream.write(": ping\n\n");
      }, 25_000);
      const clean = () => {
        clearInterval(heartbeat);
        if (listener) entry.bridge.unsubscribe(listener);
        resolveDone();
      };
      stream.onAbort(clean);

      // Single-writer pump: concurrent pushes funnel into one write loop so
      // frames can never interleave, and mid-write pushes are still drained.
      async function driveQueue(): Promise<void> {
        while (queue.length > 0) {
          const e = queue.shift();
          if (!e) break;
          if (closed) return;
          await stream.write(frame(e));
          // Terminal event flushes last, then close — never two terminals.
          if (isTerminal(e)) {
            closed = true;
            clean();
            await stream.close();
            return;
          }
        }
      }
      function runPump(): void {
        if (pumping) return;
        pumping = true;
        void driveQueue().finally(() => {
          pumping = false;
        });
      }

      runPump();

      // Hold the callback open until a terminal was flushed (clean) or the
      // client aborted (stream.onAbort). Only then may we return — Hono's
      // finally-close is a guarded no-op after our explicit stream.close().
      await done;
    });
  });

  return app;
}

function isTerminal(e: ExecutionEventEnvelope): boolean {
  return e.type === "execution.completed" || e.type === "execution.failed" || e.type === "execution.cancelled";
}

export default createExecutionsRoutes(new ExecutionHub());