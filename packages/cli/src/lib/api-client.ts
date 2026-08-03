// packages/cli/src/lib/api-client.ts
import { clearAuth, getAuth } from "./auth";

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
    create: (data: { title: string }) => request("/sessions", { method: "POST", body: data }),
    get: (id: string) => request(`/sessions/${id}`),
  },
  chat: {
    send: (sessionId: string, data: { content: string; mode: string; model: any }) =>
      request(`/chat/${sessionId}`, { method: "POST", body: data }),
    resume: (sessionId: string) =>
      request(`/chat/${sessionId}/resume`, { method: "POST" }),
  },
  providerConnections: {
    list: () => request<any[]>("/provider-connections"),
    create: (data: any) => request("/provider-connections", { method: "POST", body: data }),
    get: (id: string) => request(`/provider-connections/${id}`),
    delete: (id: string) => request(`/provider-connections/${id}`, { method: "DELETE" }),
    validate: (id: string) => request(`/provider-connections/${id}/validate`, { method: "POST" }),
  },
  auth: {
    callback: (code: string, state: string) =>
      request(`/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`),
  },
};