// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Live execution hub (CLI-V2 Phase 5).
//
// Owns the runnable executions for the gateway: builds the capability registry
// (server-authoritative — the CLI never executes tools itself, F3), resolves a
// MODEL per user, drives the unified ExecutionEngine, and funnels every engine
// emission into a per-execution ExecutionEventBridge producing the typed wire
// envelopes. State is in-memory for now (the durable log is infra/storage, wire
// later); the hub is the gateway's live view.
//
// Ordering contract (wire `seq` gapless 1-based): hub pre-assigns the execution
// id and calls bridge.begin() FIRST — that emits `execution.created` as seq 1.
// Only then does engine.run() start, so every later bus/strategy event lands at
// a strictly greater seq. The engine's own `created` bus event is ignored by the
// bridge (superseded by begin).

import { randomUUID as createId } from "node:crypto";
import { CapabilityRegistry } from "@ANCIENT/capabilities/core";
import {
  readFileTool,
  listDirectoryTool,
  globTool,
  grepTool,
  writeFileTool,
  editFileTool,
} from "@ANCIENT/capabilities/files";
import { bashTool } from "@ANCIENT/capabilities/shell";
import { listSkillsTool, useSkillTool } from "@ANCIENT/capabilities/skills";
import { fetchUrlTool } from "@ANCIENT/capabilities/browser";
import { ExecutionEngine, createAiModelChat } from "@ANCIENT/execution";
import { MemoryEventBus } from "@ANCIENT/infrastructure/events";
import { ApprovalPolicy, type RiskCategory } from "@ANCIENT/infrastructure/security";
import { DEFAULT_CHAT_MODEL_ID, type ChatModelSelection, type ModeType } from "@ANCIENT/shared";
import { resolveChatModel } from "../lib/models";
import { ExecutionEventBridge } from "./bridge";
import { ConsentBridge } from "./consent-bridge";

export type ExecutionStartRequest = {
  userId: string;
  task: string;
  mode?: ModeType;
  /** User's model selection; defaults to the builtin default model. */
  model?: ChatModelSelection;
  /** Working directory every tool path resolves against; defaults to process cwd. */
  cwd?: string;
  /** Risk categories to auto-allow beyond the default read-only policy. */
  allow?: readonly RiskCategory[];
  /** Tool allow-list (subset of the registry); undefined = all mode-visible. */
  toolAllow?: readonly string[];
};

export type ExecutionEntry = {
  executionId: string;
  userId: string;
  task: string;
  mode: ModeType;
  status: "created" | "running" | "completed" | "failed" | "cancelled";
  session: {
    cancel(reason?: string): void;
    readonly done: Promise<unknown>;
  };
  bridge: ExecutionEventBridge;
};

export class ExecutionHub {
  #engine = new ExecutionEngine({ registry: DEFAULT_REGISTRY });
  #executions = new Map<string, ExecutionEntry>();
  #consent = new ConsentBridge();

  get engine() {
    return this.#engine;
  }

  list(userId: string): ExecutionEntry[] {
    return [...this.#executions.values()].filter((e) => e.userId === userId);
  }

  get(userId: string, executionId: string): ExecutionEntry | undefined {
    const entry = this.#executions.get(executionId);
    return entry && entry.userId === userId ? entry : undefined;
  }

  /**
   * Start an execution. Resolves with a live entry AFTER the model is resolved
   * and the engine session exists — but the wire stream already opens with
   * `execution.created` on the entry's bridge, so SSE consumers that connect
   * on the returned id never miss the sequence head.
   */
  async start(request: ExecutionStartRequest): Promise<ExecutionEntry> {
    const executionId = createId();
    const bus = new MemoryEventBus();
    const bridge = new ExecutionEventBridge();

    // seq 1, before the engine emits anything.
    bridge.start({ executionId, task: request.task, mode: request.mode ?? "BUILD" });
    const unsubscribe = bus.subscribe((event) => bridge.onLifecycleEvent(event));

    const mode = request.mode ?? "BUILD";
    const entryBase = {
      executionId,
      userId: request.userId,
      task: request.task,
      mode,
    };

    try {
      const selection: ChatModelSelection = request.model ?? { modelKind: "builtin", modelId: DEFAULT_CHAT_MODEL_ID };
      const resolved = await resolveChatModel(selection, request.userId);

      const session = this.#engine.run({
        sessionId: executionId,
        task: request.task,
        scope: {
          cwd: request.cwd ?? process.cwd(),
          homedir: process.env.HOME ?? process.env.USERPROFILE ?? undefined,
          env: process.env as Record<string, string | undefined>,
        },
        policy: this.#policy(request.allow),
        model: createAiModelChat(resolved.model),
        mode,
        allow: request.toolAllow,
        consentProvider: this.#consent.createProvider(bridge, executionId),
        observe: (event) => bridge.onStrategyEvent(event),
        bus,
      });

      const entry: ExecutionEntry = {
        ...entryBase,
        status: session.status,
        session: {
          cancel: (reason?: string) => session.cancel(reason),
          done: session.done,
        },
        bridge,
      };
      this.#executions.set(executionId, entry);

      void session.done.then((result) => {
        const live = this.#executions.get(executionId);
        if (live) live.status = result.status;
        unsubscribe();
      });

      return entry;
    } catch (err) {
      // Resolution failed before a session existed — surface a terminal
      // `execution.failed` so no SSE consumer hangs on a silent execution.
      const error = err instanceof Error ? err.message : String(err);
      bridge.finish("failed", { error });
      const entry: ExecutionEntry = {
        ...entryBase,
        status: "failed",
        session: {
          cancel: () => undefined,
          done: Promise.resolve({ status: "failed" as const }),
        },
        bridge,
      };
      this.#executions.set(executionId, entry);
      unsubscribe();
      return entry;
    }
  }

  cancel(userId: string, executionId: string, reason?: string): ExecutionEntry | undefined {
    const entry = this.get(userId, executionId);
    if (!entry) return undefined;
    entry.session.cancel(reason ?? "cancelled by user");
    return entry;
  }

  /** Respond to a pending consent request (Phase 9). */
  respondToConsent(requestId: string, granted: boolean): boolean {
    return this.#consent.respond(requestId, granted);
  }

  #policy(allow: readonly RiskCategory[] | undefined): ApprovalPolicy {
    const policy = new ApprovalPolicy();
    for (const category of allow ?? []) policy.allow(category);
    return policy;
  }
}

/** The one server-authoritative tool set for every execution (F3). */
const DEFAULT_REGISTRY = new CapabilityRegistry().registerAll([
  readFileTool,
  listDirectoryTool,
  globTool,
  grepTool,
  writeFileTool,
  editFileTool,
  bashTool,
  listSkillsTool,
  useSkillTool,
  fetchUrlTool,
]);