// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 5/6 — the CLI's execution transport hook (replaces the legacy
// /chat round-trip transport; tool execution now runs server-side, F3). Every
// submit starts one execution via POST /executions and streams the typed wire
// envelopes; the CLI renders what the server emits and never invents history
// (audit F2). Session-chat history (persisted /sessions messages) is
// display-only until Phase 6 wires the timeline.
//
// Status surface: idle | submitted | streaming | ready | error.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatModelSelection, ModeType } from "@ANCIENT/shared";
import type { RiskCategory } from "@ANCIENT/infrastructure/security";
import { apiClient, streamExecutionEvents } from "../lib/api-client";
import {
  ExecutionMessageAssembler,
  type ChatMessageMetadata,
  type ExecutionMessage,
  type Message,
  type TimelineEntry,
} from "../lib/execution-stream";

export type { ChatMessageMetadata, ExecutionMessage, Message, TimelineEntry };
export type MessagePart = Message["parts"][number];

export type ExecutionStatus = "idle" | "submitted" | "streaming" | "ready" | "error";

export type SubmitParams = {
  userText: string;
  mode: ModeType;
  modelSelection: ChatModelSelection;
};

/**
 * Risk categories the CLI auto-allows on the server. Phase 9 replaces the
 * former blanket auto-allow with real consent prompts — only read stays
 * pre-allowed; everything else goes through the approval bus.
 */
const CLI_ALLOW: readonly RiskCategory[] = ["read"];

/** How long to wait for the server to honour a cancel before dropping the stream. */
const CANCEL_WATCHDOG_MS = 5_000;

/** How often to update the live duration display. */
const DURATION_TICK_MS = 200;

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
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
  const [usage, setUsage] = useState<ChatMessageMetadata["usage"]>(undefined);
  const [pendingConsent, setPendingConsent] = useState<{ requestId: string; capability: string; prompt?: string } | null>(null);
  const activeRef = useRef<ActiveRun | null>(null);
  const generationRef = useRef(0);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live duration ticker — updates every 200ms while execution is active.
  useEffect(() => {
    if (status === "submitted" || status === "streaming") {
      const assembler = activeRef.current?.assembler;
      if (assembler?.startedAt) {
        const tick = () => {
          const now = Date.now();
          setDurationMs(now - assembler.startedAt!);
        };
        tick();
        durationRef.current = setInterval(tick, DURATION_TICK_MS);
      }
    }
    return () => {
      if (durationRef.current) {
        clearInterval(durationRef.current);
        durationRef.current = null;
      }
    };
  }, [status]);

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
    setTimeline([]);
    setDurationMs(undefined);
    setUsage(undefined);
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
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
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

        // Handle approval.requested: surface to UI, don't feed to assembler.
        if (event.type === "approval.requested") {
          const p = event.payload;
          setPendingConsent({ requestId: p.requestId, capability: p.capability, prompt: p.prompt });
          continue;
        }

        assembler.apply(event);
        upsertAssistant(assembler.message);
        setTimeline(assembler.timeline);
        if (assembler.terminal) break;
      }

      if (!isCurrent(generation, controller)) return;
      teardown(controller);

      // Final state update
      setTimeline(assembler.timeline);
      setUsage(assembler.usage);
      if (assembler.startedAt && assembler.terminal) {
        setDurationMs(Date.now() - assembler.startedAt);
      }

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

  const interrupt = useCallback((): void => {
    const active = activeRef.current;
    if (!active) return;

    setStatus("ready");
    void apiClient.executions.cancel(active.executionId, "cancelled by user").catch(() => undefined);
  }, []);

  const respondToConsent = useCallback((granted: boolean): void => {
    const active = activeRef.current;
    const consent = pendingConsent;
    if (!active || !consent) return;

    setPendingConsent(null);
    void apiClient.executions.consent(active.executionId, consent.requestId, granted).catch(() => undefined);
  }, [pendingConsent]);

  return { messages, status, error, timeline, durationMs, usage, pendingConsent, submit, interrupt, respondToConsent };
}