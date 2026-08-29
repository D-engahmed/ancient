// packages/cli/src/lib/api-client.ts
import { clearAuth, getAuth } from "./auth";
import type { ExecutionEventEnvelope, ChatModelSelection, ModeType } from "@ANCIENT/shared";
import { parseExecutionEvent } from "@ANCIENT/shared";
import type { RiskCategory } from "@ANCIENT/infrastructure/security";
import { sseFrames } from "./execution-stream";

export const API_URL = process.env.API_URL ?? "http://localhost:3000";

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
};

async function request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };
  const auth = getAuth();
  if (auth) {
    headers["Authorization"] = `Bearer ${auth.token}`;
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401) {
    clearAuth();
    throw new Error("Unauthorized – please run /login again");
  }

  if (!response.ok) {
    let errorMessage = response.statusText;
    try {
      // FIXED: response.json() types as `unknown` under this project's
      // TS/lib config, so property access on it was a real compile error.
      const data = await response.json() as { error?: string; message?: string };
      errorMessage = data.error || data.message || errorMessage;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return null as T;
  }

  // FIXED: cast to the caller's T — response.json() resolves to `unknown`,
  // not `any`, so returning it directly didn't satisfy `Promise<T>`.
  return response.json() as Promise<T>;
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
 */
export async function* streamExecutionEvents(
  executionId: string,
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<ExecutionEventEnvelope> {
  const headers: Record<string, string> = {};
  const auth = getAuth();
  if (auth) headers["Authorization"] = `Bearer ${auth.token}`;

  const response = await fetch(`${API_URL}/executions/${executionId}/events`, {
    headers,
    signal: options.signal,
  });

  if (response.status === 401) {
    clearAuth();
    throw new Error("Unauthorized – please run /login again");
  }
  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = (await response.json()) as { error?: string; message?: string };
      message = data.error || data.message || message;
    } catch {
      // non-JSON error body
    }
    throw new Error(message);
  }

  const frames = sseFrames(response.body);
  for await (const frame of frames) {
    // Heartbeats produce no data and are skipped by the frame parser, but be
    // defensive: a data-less frame must not emit a fake envelope.
    if (!frame.data.trim()) continue;
    yield parseExecutionEvent(JSON.parse(frame.data));
  }
}