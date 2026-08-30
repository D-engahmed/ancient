// packages/cli/src/lib/api-client.ts
import { clearAuth, getAuth } from "./auth";
import type { ExecutionEventEnvelope, ChatModelSelection, ModeType } from "@ANCIENT/shared";
import { parseExecutionEvent } from "@ANCIENT/shared";
import type { RiskCategory } from "@ANCIENT/infrastructure/security";
import { sseFrames } from "./execution-stream";
import { errorMessageFrom } from "./http-errors";

export const API_URL = process.env.API_URL ?? "http://localhost:3000";

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  maxRetries?: number;
};

async function request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const url = `${API_URL}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };
    const auth = getAuth();
    if (auth) {
      headers["Authorization"] = `Bearer ${auth.token}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
      // Network error — retry with exponential backoff
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 5_000)));
        continue;
      }
      throw lastError;
    }

    if (response.status === 401) {
      clearAuth();
      throw new Error("Unauthorized – please run /login again");
    }

    // Client errors (4xx) are not retried — only 5xx and network errors
    if (!response.ok && response.status >= 500 && attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 5_000)));
      continue;
    }

    if (!response.ok) {
      let errorMessage = response.statusText;
      try {
        const data = await response.json() as { error?: unknown; message?: unknown };
        errorMessage = errorMessageFrom(data) || errorMessage;
      } catch {
        // ignore JSON parse errors
      }
      throw new Error(errorMessage);
    }

    if (response.status === 204) {
      return null as T;
    }

    // Some 2xx responses carry an empty body (e.g. bare "ok" DELETEs). Try
    // JSON first, fall back to raw text, and return null for truly empty
    // bodies so callers never see a raw "Unexpected end of JSON input".
    const raw = await response.text();
    if (!raw) return null as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }

  throw lastError ?? new Error("request failed");
}

export const apiClient = {
  sessions: {
    list: () => request<any[]>("/sessions"),
    create: (data: { title: string; cwd?: string }) => request("/sessions", { method: "POST", body: data }),
    get: (id: string) => request(`/sessions/${id}`),
  },
  extensions: {
    skills: (cwd?: string) =>
      request<any[]>(`/extensions/skills${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),
    agents: (cwd?: string) =>
      request<any[]>(`/extensions/agents${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),
    commands: (cwd?: string) =>
      request<any[]>(`/extensions/commands${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),
    mcpServers: (cwd?: string) =>
      request<any[]>(`/extensions/mcp${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),
    reloadMcp: () => request("/extensions/mcp/reload", { method: "POST" }),
    compact: (sessionId: string) =>
      request(`/extensions/compact/${sessionId}`, { method: "POST" }),
    checkpoints: (sessionId: string) =>
      request<any[]>(`/extensions/checkpoints/${sessionId}`),
    rewind: (sessionId: string, checkpointId: string) =>
      request(`/extensions/rewind/${sessionId}`, { method: "POST", body: { checkpointId } }),
  },
  providerConnections: {
    list: () => request<any[]>("/provider-connections"),
    create: (data: any) => request("/provider-connections", { method: "POST", body: data }),
    get: (id: string) => request(`/provider-connections/${id}`),
    // Server route already existed (PATCH /:id) — client just never had a
    // wrapper for it, so nothing in the CLI could call it.
    update: (id: string, data: any) =>
      request(`/provider-connections/${id}`, { method: "PATCH", body: data }),
    delete: (id: string) => request(`/provider-connections/${id}`, { method: "DELETE" }),
    validate: (id: string) => request(`/provider-connections/${id}/validate`, { method: "POST" }),
  },
  auth: {
    callback: (code: string, state: string) =>
      request(`/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`),
  },
  usage: {
    list: () => request<any[]>("/usage"),
    get: (connectionId: string) => request(`/usage/${connectionId}`),
  },
  pipeline: {
    start: (cwd: string, stages?: string[]) =>
      request<{ id: string }>("/pipeline", {
        method: "POST",
        body: stages ? { cwd, stages } : { cwd },
      }),
    status: (id: string) =>
      request<{ id: string; status: string; result?: any; error?: string }>(
        `/pipeline/status/${id}`
      ),
  },
  executions: {
    start: (data: {
      task: string;
      mode: ModeType;
      model: ChatModelSelection;
      cwd?: string;
      allow?: readonly RiskCategory[];
    }) => request<{ executionId: string; status: string }>("/executions", { method: "POST", body: data }),
    list: () => request<{ executions: unknown[] }>("/executions"),
    get: (executionId: string) => request<{ executionId: string; status: string }>(`/executions/${executionId}`),
    cancel: (executionId: string, reason?: string) =>
      request(`/executions/${executionId}/cancel`, {
        method: "POST",
        body: reason ? { reason } : {},
      }),
    consent: (executionId: string, requestId: string, granted: boolean) =>
      request(`/executions/${executionId}/consent`, {
        method: "POST",
        body: { requestId, granted },
      }),
  },
};

/**
 * Open the SSE event stream for one execution and yield decoded, schema-checked
 * wire envelopes in seq order. Rejects on non-2xx (401 clears auth). The caller
 * owns the AbortSignal — aborting mid-stream just stops iteration.
 *
 * Supports automatic reconnection: when the stream drops unexpectedly, it
 * reconnects with Last-Event-ID to resume from the last received envelope.
 */
export async function* streamExecutionEvents(
  executionId: string,
  options: { signal?: AbortSignal; maxReconnects?: number } = {},
): AsyncGenerator<ExecutionEventEnvelope> {
  const maxReconnects = options.maxReconnects ?? 3;
  let reconnects = 0;
  let lastEventId = 0;

  while (reconnects <= maxReconnects) {
    const headers: Record<string, string> = {
      "Accept": "text/event-stream",
      "Cache-Control": "no-cache",
    };
    const auth = getAuth();
    if (auth) headers["Authorization"] = `Bearer ${auth.token}`;
    if (lastEventId > 0) headers["Last-Event-ID"] = String(lastEventId);

    let response: Response;
    try {
      response = await fetch(`${API_URL}/executions/${executionId}/events`, {
        headers,
        signal: options.signal,
      });
    } catch (err) {
      // Network error — attempt reconnection unless aborted
      if (options.signal?.aborted) return;
      reconnects++;
      if (reconnects > maxReconnects) {
        throw new Error(`SSE connection failed after ${maxReconnects} retries`);
      }
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** reconnects, 10_000)));
      continue;
    }

    if (response.status === 401) {
      clearAuth();
      throw new Error("Unauthorized – please run /login again");
    }
    if (!response.ok) {
      let message = response.statusText;
      try {
        const data = (await response.json()) as { error?: unknown; message?: unknown };
        message = errorMessageFrom(data) || message;
      } catch {
        // non-JSON error body
      }
      throw new Error(message);
    }

    // Successful connection — reset reconnect counter
    reconnects = 0;

    const frames = sseFrames(response.body);
    for await (const frame of frames) {
      if (options.signal?.aborted) return;
      if (!frame.data.trim()) continue;
      const event = parseExecutionEvent(JSON.parse(frame.data));
      lastEventId = event.seq;
      yield event;
    }

    // Stream ended normally (server closed after terminal event) — done
    return;
  }
}