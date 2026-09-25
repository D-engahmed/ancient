describe("resolveApiUrl", () => {
  test("allows loopback HTTP for local development", () => {
    expect(resolveApiUrl("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(resolveApiUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });

  test("requires HTTPS for non-loopback endpoints", () => {
    expect(() => resolveApiUrl("http://10.0.0.5:3000")).toThrow(/require HTTPS/);
    expect(resolveApiUrl("https://ancient.example.com/")).toBe("https://ancient.example.com");
  });

  test("rejects embedded credentials and ambiguous URL components", () => {
    expect(() => resolveApiUrl("https://user:pass@example.com")).toThrow(/credentials/);
    expect(() => resolveApiUrl("https://example.com?token=secret")).toThrow(/query parameters/);
    expect(() => resolveApiUrl("https://example.com/#fragment")).toThrow(/fragments/);
  });
});

// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 — api-client unit tests (fetch wrapper + SSE stream).
// Stubs global fetch; never touches the network.

import { afterEach, describe, expect, test } from "bun:test";
import { apiClient, resolveApiUrl, streamExecutionEvents } from "./api-client";

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

  test("reads the envelope message from a Gateway ErrorEnvelope response", async () => {
    stubFetch(() =>
      jsonResponse(
        {
          error: {
            code: "EDGE_RATE_LIMITED",
            message: "Too many AI requests. Please try again shortly.",
            retryable: true,
            retryAfterMs: 30_000,
            traceId: "trace-1",
          },
        },
        429,
      ),
    );
    await expect(apiClient.sessions.list()).rejects.toThrow(
      "Too many AI requests. Please try again shortly.",
    );
  });

  test("falls back to {message} when the gateway body has no usable error", async () => {
    stubFetch(() => jsonResponse({ message: "boom" }, 400));
    await expect(apiClient.sessions.list()).rejects.toThrow("boom");
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
  test("sends SSE-appropriate headers and yields decoded envelopes through terminal", async () => {
    let capturedInit: RequestInit | undefined;
    const created = JSON.stringify({
      v: 1,
      seq: 1,
      ts: new Date().toISOString(),
      executionId: "EXEC-1",
      type: "execution.created",
      payload: { task: "t", mode: "BUILD" },
    });
    const completed = JSON.stringify({
      v: 1,
      seq: 2,
      ts: new Date().toISOString(),
      executionId: "EXEC-1",
      type: "execution.completed",
      payload: { output: "done" },
    });
    stubFetch((url, init) => {
      capturedInit = init;
      expect(url).toBe("http://localhost:3000/executions/EXEC-1/events");
      return sseResponse(
        `id: 1\nevent: execution\ndata: ${created}\n\nid: 2\nevent: execution\ndata: ${completed}\n\n`,
      );
    });

    const events: unknown[] = [];
    for await (const event of streamExecutionEvents("EXEC-1")) events.push(event);

    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers?.["Accept"]).toBe("text/event-stream");
    expect(headers?.["Cache-Control"]).toBe("no-cache");
    expect(events).toHaveLength(2);
    expect((events[0] as { seq: number }).seq).toBe(1);
    expect((events[1] as { seq: number; type: string }).type).toBe("execution.completed");
  });

  test("reconnects from Last-Event-ID when the server closes before terminal", async () => {
    let calls = 0;
    stubFetch((url, init) => {
      calls++;
      expect(url).toBe("http://localhost:3000/executions/EXEC-2/events");
      const headers = init?.headers as Record<string, string> | undefined;
      if (calls === 1) {
        expect(headers?.["Last-Event-ID"]).toBeUndefined();
        return sseResponse(`id: 1\nevent: execution\ndata: ${JSON.stringify({
          v: 1,
          seq: 1,
          ts: new Date().toISOString(),
          executionId: "EXEC-2",
          type: "execution.created",
          payload: { task: "t", mode: "BUILD" },
        })}\n\n`);
      }
      expect(headers?.["Last-Event-ID"]).toBe("1");
      return sseResponse(`id: 2\nevent: execution\ndata: ${JSON.stringify({
        v: 1,
        seq: 2,
        ts: new Date().toISOString(),
        executionId: "EXEC-2",
        type: "execution.completed",
        payload: { output: "recovered" },
      })}\n\n`);
    });

    const events: unknown[] = [];
    for await (const event of streamExecutionEvents("EXEC-2", { maxReconnects: 1, retryDelayMs: 0 })) {
      events.push(event);
    }

    expect(calls).toBe(2);
    expect(events.map((event) => (event as { seq: number }).seq)).toEqual([1, 2]);
  });

  test("throws a readable error when the stream request fails", async () => {
    stubFetch(() => jsonResponse({ error: "Execution not found" }, 404));
    const gen = streamExecutionEvents("missing", { signal: new AbortController().signal });
    await expect(gen.next()).rejects.toThrow("Execution not found");
  });

  test("reads the envelope message from a failed stream request", async () => {
    stubFetch(() =>
      jsonResponse(
        {
          error: {
            code: "SYSTEM_UNKNOWN",
            message: "Something went wrong on our side.",
            retryable: false,
            traceId: "trace-2",
          },
        },
        500,
      ),
    );
    const gen = streamExecutionEvents("missing", { signal: new AbortController().signal });
    await expect(gen.next()).rejects.toThrow("Something went wrong on our side.");
  });
});