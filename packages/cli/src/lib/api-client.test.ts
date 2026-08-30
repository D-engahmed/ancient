// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 — api-client unit tests (fetch wrapper + SSE stream).
// Stubs global fetch; never touches the network.

import { afterEach, describe, expect, test } from "bun:test";
import { apiClient, streamExecutionEvents } from "./api-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 200): Response {
  return new Response(null, { status });
}

function sseResponse(frames: string): Response {
  return new Response(frames, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("apiClient.request", () => {
  test("parses a JSON 2xx body", async () => {
    stubFetch(() => jsonResponse([{ id: "s1" }]));
    const sessions = await apiClient.sessions.list();
    expect(sessions).toEqual([{ id: "s1" }]);
  });

  test("returns null for a 2xx response with an empty body", async () => {
    stubFetch(() => emptyResponse(200));
    const result = await apiClient.sessions.list();
    expect(result).toBeNull();
  });

  test("surfaces the server's {error} message on a 4xx", async () => {
    stubFetch(() => jsonResponse({ error: "Connection not found" }, 422));
    await expect(apiClient.sessions.list()).rejects.toThrow("Connection not found");
  });

  test("throws a clear message on 401 (auth cleared by caller)", async () => {
    stubFetch(() => jsonResponse({ error: "Unauthorized" }, 401));
    await expect(apiClient.sessions.list()).rejects.toThrow(/Unauthorized/);
  });

  test("retries a 5xx and succeeds on the next attempt", async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return calls === 1 ? jsonResponse({ error: "oops" }, 503) : jsonResponse([{ id: "s1" }]);
    });
    const sessions = await apiClient.sessions.list();
    expect(calls).toBe(2);
    expect(sessions).toEqual([{ id: "s1" }]);
  });
});

describe("streamExecutionEvents", () => {
  test("sends SSE-appropriate headers and yields decoded envelopes", async () => {
    let capturedInit: RequestInit | undefined;
    const envelope = JSON.stringify({
      v: 1,
      seq: 1,
      ts: new Date().toISOString(),
      executionId: "EXEC-1",
      type: "execution.created",
      payload: { task: "t", mode: "BUILD" },
    });
    stubFetch((url, init) => {
      capturedInit = init;
      expect(url).toBe("http://localhost:3000/executions/EXEC-1/events");
      return sseResponse(`id: 1\nevent: execution\ndata: ${envelope}\n\n`);
    });

    const events: unknown[] = [];
    for await (const event of streamExecutionEvents("EXEC-1")) {
      events.push(event);
    }

    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers?.["Accept"]).toBe("text/event-stream");
    expect(headers?.["Cache-Control"]).toBe("no-cache");
    expect(events.length).toBe(1);
    const first = events[0] as { seq: number; type: string; payload: { task: string } };
    expect(first.seq).toBe(1);
    expect(first.type).toBe("execution.created");
    expect(first.payload.task).toBe("t");
  });

  test("throws a readable error when the stream request fails", async () => {
    stubFetch(() => jsonResponse({ error: "Execution not found" }, 404));
    const gen = streamExecutionEvents("missing", { signal: new AbortController().signal });
    await expect(gen.next()).rejects.toThrow("Execution not found");
  });
});