// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 5/6 — SSE decoder + execution-message assembler tests.

import { describe, expect, test } from "bun:test";
import type { ExecutionEventEnvelope } from "@ANCIENT/shared";
import {
  ExecutionMessageAssembler,
  parseSseFrame,
  sseFrames,
  type SseFrame,
} from "./execution-stream";

function env(seq: number, type: ExecutionEventEnvelope["type"], payload: Record<string, unknown>): ExecutionEventEnvelope {
  return {
    v: 1,
    seq,
    ts: new Date(Date.now() - 1_000).toISOString(),
    executionId: "EXEC",
    type: type as ExecutionEventEnvelope["type"],
    payload: payload as ExecutionEventEnvelope["payload"],
  } as unknown as ExecutionEventEnvelope;
}

describe("parseSseFrame", () => {
  test("reads id/event/data fields and strips the field prefix space", () => {
    const frame = parseSseFrame('id: 7\nevent: execution\ndata: {"seq":7}');
    expect(frame).toEqual({ lastEventId: "7", data: '{"seq":7}' });
  });

  test("joins multi-line data with newlines (RFC 2426)", () => {
    const frame = parseSseFrame("data: line1\ndata: line2\ndata: line3");
    expect(frame?.data).toBe("line1\nline2\nline3");
  });

  test("ignores comment/heartbeat frames and data-less blocks", () => {
    expect(parseSseFrame(": ping")).toBeNull();
    expect(parseSseFrame("event: execution")).toBeNull();
  });

  test("handles CRLF line endings", () => {
    expect(parseSseFrame("id: 1\r\ndata: {}\r\n")?.data).toBe("{}");
  });
});

describe("sseFrames", () => {
  function toStream(chunks: string[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
  }

  async function collect(body: ReadableStream<Uint8Array>): Promise<SseFrame[]> {
    const out: SseFrame[] = [];
    for await (const frame of sseFrames(body)) out.push(frame);
    return out;
  }

  test("yields frames split across chunks, one per blank-line separator", async () => {
    const body = toStream([
      'id: 1\nevent: execution\ndata: {"seq":1}\n\nid: 2\nevent: execut',
      'ion\ndata: {"seq":2}\n\n',
    ]);
    const frames = await collect(body);
    expect(frames.map((f) => f.lastEventId)).toEqual(["1", "2"]);
    expect(frames.map((f) => f.data)).toEqual(['{"seq":1}', '{"seq":2}']);
  });

  test("skips heartbeat comments between real frames", async () => {
    const body = toStream([": ping\n\nid: 3\ndata: {}\n\n: ping\n\nid: 4\ndata: {}\n\n"]);
    const frames = await collect(body);
    expect(frames.map((f) => f.lastEventId)).toEqual(["3", "4"]);
  });

  test("flushes a trailing frame with no separator at end of stream", async () => {
    const body = toStream([": ping\n\nid: 9\ndata: {}\n\nid: 10\ndata: {}"]);
    const frames = await collect(body);
    expect(frames.map((f) => f.lastEventId)).toEqual(["9", "10"]);
  });

  test("returns nothing for a bodyless stream", async () => {
    expect(await collect(null as unknown as ReadableStream<Uint8Array>)).toEqual([]);
  });
});

describe("ExecutionMessageAssembler", () => {
  function assemble(events: ExecutionEventEnvelope[]) {
    const assembler = new ExecutionMessageAssembler("EXEC", {
      mode: "BUILD",
      model: { modelKind: "builtin", modelId: "anthropic:claude" },
    });
    for (const event of events) assembler.apply(event);
    return assembler;
  }

  test("concatenates text deltas and pairs capability calls into tool parts", () => {
    const a = assemble([
      env(1, "execution.created", { task: "t" }),
      env(2, "execution.started", { task: "t" }),
      env(3, "text.delta", { text: "Checking " }),
      env(4, "text.delta", { text: "the mapping…" }),
      env(5, "capability.requested", { callId: "c1", capability: "readFile", args: { path: "a.ts" } }),
      env(6, "capability.completed", { callId: "c1", capability: "readFile", ok: true, result: "src" }),
      env(7, "execution.completed", { usage: { inputTokens: 10, outputTokens: 4 } }),
    ]);

    const msg = a.message;
    expect(msg.id).toBe("EXEC");
    expect(msg.role).toBe("assistant");
    expect(msg.parts).toEqual([
      { type: "text", text: "Checking the mapping…" },
      { type: "tool", callId: "c1", name: "readFile", args: { path: "a.ts", __result: "src" }, state: "ok" },
    ]);
    expect(msg.metadata?.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    expect(a.terminal).toBe("completed");
  });

  test("tool part carries an error result when the call fails", () => {
    const a = assemble([
      env(1, "capability.requested", { callId: "x", capability: "bash", args: { command: "rm -rf /" } }),
      env(2, "capability.completed", { callId: "x", capability: "bash", ok: false, error: "denied" }),
    ]);
    expect(a.message.parts).toEqual([
      { type: "tool", callId: "x", name: "bash", args: { command: "rm -rf /", __error: "denied" }, state: "error" },
    ]);
  });

  test("falls back to the completed payload output when there were no deltas", () => {
    const a = assemble([env(1, "execution.completed", { output: "final rollup text" })]);
    expect((a.message.parts[0] as { type: "text"; text: string }).text).toBe("final rollup text");
  });

  test("failed terminal exposes the client-safe error, terminal stays failed", () => {
    const a = assemble([
      env(1, "execution.failed", {
        error: { code: "SYSTEM_UNKNOWN", message: "boom", retryable: false, traceId: "tr-1" },
      }),
    ]);
    expect(a.terminal).toBe("failed");
    expect(a.error?.message).toBe("boom");
    expect(a.message.parts).toEqual([]);
  });

  test("cancelled is a distinct terminal state", () => {
    const a = assemble([env(1, "text.delta", { text: "half" }), env(2, "execution.cancelled", { reason: "user" })]);
    expect(a.terminal).toBe("cancelled");
    expect(a.message.parts).toEqual([{ type: "text", text: "half" }]);
  });

  test("first terminal wins; later terminals are ignored", () => {
    const a = assemble([
      env(1, "execution.completed", {}),
      env(2, "execution.failed", { error: { code: "X", message: "late", retryable: false, traceId: "t" } }),
    ]);
    expect(a.terminal).toBe("completed");
    expect(a.error).toBeUndefined();
  });

  test("unknown/future event types are ignored without corrupting the message", () => {
    const a = assemble([
      env(1, "context.ready", { blocks: ["b"] }),
      env(2, "model.called", { modelRef: "m" }),
      env(3, "usage.recorded", { inputTokens: 1, outputTokens: 1 }),
      env(4, "execution.paused", { reason: "r" }),
      env(5, "text.delta", { text: "ok" }),
      env(6, "execution.completed", {}),
    ]);
    expect(a.message.parts).toEqual([{ type: "text", text: "ok" }]);
  });

  test("durationMs spans started→terminal envelopes", () => {
    const assembler = new ExecutionMessageAssembler("EXEC", {});
    const startedAt = new Date(Date.now() - 250).toISOString();
    assembler.apply({
      v: 1,
      seq: 1,
      ts: startedAt,
      executionId: "EXEC",
      type: "execution.started",
      payload: { task: "t" },
    } as unknown as ExecutionEventEnvelope);
    assembler.apply({
      v: 1,
      seq: 2,
      ts: new Date().toISOString(),
      executionId: "EXEC",
      type: "execution.completed",
      payload: {},
    } as unknown as ExecutionEventEnvelope);
    const durationMs = assembler.message.metadata?.durationMs;
    expect(typeof durationMs).toBe("number");
    expect(durationMs!).toBeGreaterThanOrEqual(100);
    expect(durationMs!).toBeLessThanOrEqual(1500);
  });
});