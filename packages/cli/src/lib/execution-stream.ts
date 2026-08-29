// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 5/6 — pure clients of the execution wire contract.
//
// Two cooperating pieces, both dependency-free of React so they are unit tested
// directly:
//   1. sseFrames/parseSseFrame — a WHATWG-stream SSE frame decoder (RFC 2426:
//      `id:` / `event:` / `data:` fields, multi-line data, comment heartbeats).
//   2. ExecutionMessageAssembler — folds a slice of typed wire envelopes into
//      one assistant message (text deltas concatenated, capability calls paired,
//      terminal metadata attached). The gateway sends EXACTLY these envelopes;
//      the CLI never invents history (audit F2 / Phase 6).

import type {
  ChatModelSelection,
  ClientSafeError,
  ExecutionEventEnvelope,
  ModeType,
} from "@ANCIENT/shared";

export type SseFrame = {
  /** The value of the last `id:` field in the frame, if any. */
  lastEventId: string | null;
  /** Concatenated `data:` lines (multi-line data joined by "\n"). */
  data: string;
};

/**
 * Decode one complete SSE frame block (everything between blank-line
 * separators). Comment lines (starting with ":") — e.g. the server's 25s
 * heartbeat `: ping` — are skipped. Returns null for a block with no data.
 */
export function parseSseFrame(block: string): SseFrame | null {
  let lastEventId: string | null = null;
  const dataLines: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    if (rawLine.startsWith(":")) continue;
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    const value = colon === -1 ? "" : rawLine.slice(colon + 1).replace(/^ /, "");
    if (field === "id") lastEventId = value || null;
    else if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  return { lastEventId, data: dataLines.join("\n") };
}

/**
 * Async-iterate complete SSE frames out of a response body. Handles frames
 * split across network chunks and CRLF vs LF line endings. Heartbeats yield
 * nothing (callers keep waiting for real frames).
 */
export async function* sseFrames(body: ReadableStream<Uint8Array> | null): AsyncGenerator<SseFrame> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = searchFrameSeparator(buffer)) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, "");
        const parsed = parseSseFrame(block);
        if (parsed) yield parsed;
      }
    }

    buffer += decoder.decode();
    for (const block of buffer.split(/\r?\n\r?\n/)) {
      const parsed = parseSseFrame(block);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

function searchFrameSeparator(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

export type ToolPartState = "running" | "ok" | "error";

export type ExecutionMessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      callId: string;
      name: string;
      args: Record<string, unknown>;
      state: ToolPartState;
    };

export type ChatMessageMetadata = {
  mode?: ModeType;
  model?: ChatModelSelection;
  durationMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
};

export type ExecutionMessage = {
  /** Correlates with the execution id (later: the session→execution timeline). */
  id: string;
  role: "assistant";
  parts: ExecutionMessagePart[];
  metadata?: ChatMessageMetadata;
};

export type Message =
  | { id: string; role: "user"; parts: [{ type: "text"; text: string }]; metadata?: ChatMessageMetadata }
  | ExecutionMessage;

export const TERMINAL_STATES = ["completed", "failed", "cancelled"] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];

export type TimelineEntry = {
  id: string;
  label: string;
  status: "done" | "running" | "pending" | "error";
};

/**
 * Incremental projection of an execution's envelopes into the assistant
 * message the CLI renders. `apply` is pure-ish (mutates internal drafts only)
 * and idempotent per envelope — callers feed events exactly once, in seq order
 * (replay slices from Last-Event-ID must still be forwarded in stream order).
 */
export class ExecutionMessageAssembler {
  readonly id: string;
  #meta: ChatMessageMetadata;
  #text: string[] = [];
  #tools = new Map<string, { name: string; args: Record<string, unknown>; state: ToolPartState }>();
  #terminal: TerminalState | null = null;
  #terminalPayload: { output?: string; usage?: ChatMessageMetadata["usage"]; error?: ClientSafeError; reason?: string } = {};
  #startedAt: number | null = null;
  #finishedAt: number | null = null;

  constructor(executionId: string, meta: ChatMessageMetadata) {
    this.id = executionId;
    this.#meta = meta;
  }

  apply(event: ExecutionEventEnvelope): void {
    const ts = Date.parse(event.ts);

    switch (event.type) {
      case "execution.started":
        this.#startedAt ??= Number.isFinite(ts) ? ts : null;
        break;
      case "text.delta":
        this.#text.push(event.payload.text);
        break;
      case "capability.requested": {
        const { callId, capability, tool, args } = event.payload;
        this.#tools.set(callId, {
          name: tool ?? capability,
          args: args ?? {},
          state: "running",
        });
        break;
      }
      case "capability.completed": {
        const { callId, ok, result, error } = event.payload;
        const existing = this.#tools.get(callId);
        if (existing) {
          existing.state = ok ? "ok" : "error";
          if (result) existing.args = { ...existing.args, __result: result };
          if (error) existing.args = { ...existing.args, __error: error };
        }
        break;
      }
      case "execution.completed": {
        if (this.#terminal === null) {
          this.#terminal = "completed";
          this.#terminalPayload = {
            output: event.payload.output,
            usage: event.payload.usage,
          };
          this.#finishedAt = Number.isFinite(ts) ? ts : null;
        }
        break;
      }
      case "execution.failed": {
        if (this.#terminal === null) {
          this.#terminal = "failed";
          this.#terminalPayload = { error: event.payload.error };
          this.#finishedAt = Number.isFinite(ts) ? ts : null;
        }
        break;
      }
      case "execution.cancelled": {
        if (this.#terminal === null) {
          this.#terminal = "cancelled";
          this.#terminalPayload = { reason: event.payload.reason };
          this.#finishedAt = Number.isFinite(ts) ? ts : null;
        }
        break;
      }
      default:
        // Unknown / future event types are ignored (wire invariant 3).
        break;
    }
  }

  get terminal(): TerminalState | null {
    return this.#terminal;
  }

  get error(): ClientSafeError | undefined {
    return this.#terminalPayload.error;
  }

  get message(): ExecutionMessage {
    const parts: ExecutionMessagePart[] = [];

    const text = this.#text.join("");
    if (text.length > 0 || this.#terminal === "completed") {
      parts.push({ type: "text", text: text || this.#terminalPayload.output || "" });
    }

    for (const [callId, tool] of this.#tools) {
      parts.push({ type: "tool", callId, name: tool.name, args: tool.args, state: tool.state });
    }

    const durationMs =
      this.#startedAt != null && this.#finishedAt != null
        ? Math.max(0, this.#finishedAt - this.#startedAt)
        : undefined;

    return {
      id: this.id,
      role: "assistant",
      parts,
      metadata: {
        ...this.#meta,
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(this.#terminalPayload.usage ? { usage: this.#terminalPayload.usage } : {}),
      },
    };
  }

  /** Structured timeline entries for the ExecutionTimeline component. */
  get timeline(): TimelineEntry[] {
    const entries: TimelineEntry[] = [];
    for (const [callId, tool] of this.#tools) {
      entries.push({
        id: callId,
        label: tool.name,
        status: tool.state === "running" ? "running" : tool.state === "ok" ? "done" : "error",
      });
    }
    return entries;
  }

  /** Current usage metrics (available after terminal). */
  get usage(): ChatMessageMetadata["usage"] {
    return this.#terminalPayload.usage;
  }

  /** Timestamp when execution started (for live duration calculation). */
  get startedAt(): number | null {
    return this.#startedAt;
  }

  /** Whether the assembler has received any events. */
  get hasStarted(): boolean {
    return this.#startedAt !== null;
  }
}