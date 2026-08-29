// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 5 — the CLI's execution transport hook (replaces the legacy
// /chat round-trip transport; tool execution now runs server-side, F3). Every
// submit starts one execution via POST /executions and streams the typed wire
// envelopes; the CLI renders what the server emits and never invents history
// (audit F2). Session-chat history (persisted /sessions messages) is
// display-only until Phase 6 wires the timeline.
//
// Status surface (kept compatible with the previous hook so session.tsx needs
// no structural change): idle | submitted | streaming | ready | error.

import { useRef, useState } from "react";
import type { ChatModelSelection, ModeType } from "@ANCIENT/shared";
import type { RiskCategory } from "@ANCIENT/infrastructure/security";
import { apiClient, streamExecutionEvents } from "../lib/api-client";
import {
  ExecutionMessageAssembler,
  type ChatMessageMetadata,
  type ExecutionMessage,
  type Message,
} from "../lib/execution-stream";

export type { ChatMessageMetadata, ExecutionMessage, Message };
export type MessagePart = Message["parts"][number];

export type ExecutionStatus = "idle" | "submitted" | "streaming" | "ready" | "error";

export type SubmitParams = {
  userText: string;
  mode: ModeType;
  modelSelection: ChatModelSelection;
};

/**
 * Risk categories the CLI auto-allows on the server (mirrors the legacy local
 * executor, which ran any tool unfettered). Placeholder until the approval UX
 * (Phase 9) replaces it — the engine still denies by default.
 */
const CLI_ALLOW: readonly RiskCategory[] = ["read", "write", "exec", "network", "scope"];

/** How long to wait for the server to honour a cancel before dropping the stream. */
const CANCEL_WATCHDOG_MS = 5_000;

type ActiveRun = {
  executionId: string;
  assembler: ExecutionMessageAssembler;
  controller: AbortController;
  watchdog: ReturnType<typeof setTimeout>;
};

export function useExecution(initialMessages: Message[] = []) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [status, setStatus] = useState<ExecutionStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const activeRef = useRef<ActiveRun | null>(null);
  const generationRef = useRef(0);

  function upsertAssistant(message: ExecutionMessage) {
    setMessages((prev) => {
      const next = [...prev];
      const idx = next.findIndex((m) => m.id === message.id);
      if (idx >= 0) next[idx] = message;
      else next.push(message);
      return next;
    });
  }

  function submit(params: SubmitParams): boolean {
    if (status === "submitted" || status === "streaming") return false;
    const generation = ++generationRef.current;

    setError(null);
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: "user",
        parts: [{ type: "text", text: params.userText }],
      },
    ]);
    setStatus("submitted");

    void run(params, generation, new AbortController());
    return true;
  }

  function isCurrent(generation: number, controller: AbortController): boolean {
    return generation === generationRef.current && !controller.signal.aborted;
  }

  function teardown(controller: AbortController) {
    const active = activeRef.current;
    if (active?.controller === controller) {
      clearTimeout(active.watchdog);
      activeRef.current = null;
    }
  }

  async function run(params: SubmitParams, generation: number, controller: AbortController) {
    try {
      const started = await apiClient.executions.start({
        task: params.userText,
        mode: params.mode,
        model: params.modelSelection,
        cwd: process.cwd(),
        allow: CLI_ALLOW,
      });
      if (!isCurrent(generation, controller)) return;

      const assembler = new ExecutionMessageAssembler(started.executionId, {
        mode: params.mode,
        model: params.modelSelection,
      });
      const watchdog = setTimeout(() => {
        if (activeRef.current?.controller !== controller) return;
        // The server never sent a terminal after a cancel — stop waiting.
        controller.abort();
        teardown(controller);
        setStatus("ready");
      }, CANCEL_WATCHDOG_MS);
      (watchdog as unknown as { unref?: () => void }).unref?.();

      activeRef.current = { executionId: started.executionId, assembler, controller, watchdog };
      setStatus("streaming");

      for await (const event of streamExecutionEvents(started.executionId, {
        signal: controller.signal,
      })) {
        if (!isCurrent(generation, controller)) return;
        assembler.apply(event);
        upsertAssistant(assembler.message);
        if (assembler.terminal) break;
      }

      if (!isCurrent(generation, controller)) return;
      teardown(controller);

      if (assembler.terminal === "failed") {
        const safe = assembler.error;
        setError(
          new Error(
            safe
              ? `${safe.message}${safe.traceId ? ` (trace ${safe.traceId})` : ""}`
              : "Execution failed",
          ),
        );
        setStatus("error");
      } else {
        setStatus("ready");
      }
    } catch (err) {
      if (!isCurrent(generation, controller)) return;
      teardown(controller);
      if (controller.signal.aborted) {
        setStatus("ready");
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setError(new Error(message));
      setStatus("error");
    }
  }

  function interrupt(): void {
    const active = activeRef.current;
    if (!active) return;

    // Request server-side cancellation (the engine honours it via the session
    // cancel); the watchdog drops the stream if the terminal never arrives.
    setStatus("ready");
    void apiClient.executions.cancel(active.executionId, "cancelled by user").catch(() => undefined);
  }

  return { messages, status, error, submit, interrupt };
}