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
import { ExecutionEngine, createAiModelChat, type ExecutionStatus } from "@ANCIENT/execution";
import { MemoryEventBus } from "@ANCIENT/infrastructure/events";
import { ApprovalPolicy, Redactor, type RiskCategory } from "@ANCIENT/infrastructure/security";
import { DEFAULT_CHAT_MODEL_ID, type ChatModelSelection, type ModeType } from "@ANCIENT/shared";
import { resolveChatModel } from "../lib/models";
import { modelKey, checkCooldown, recordRateLimitFailure, RateLimitCooldownError } from "../lib/rate-limit-breaker";
import { selectHealthyFallbackModel } from "../lib/fallback";
import { clientErrorFrom } from "../lib/error-mapper";
import { loadSettings } from "../hooks/settings";
import { ExecutionEventBridge, type BridgeFallbackDetail } from "./bridge";
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
  /** Effective model ref that ran (the user's selection, or the healthy
   *  fallback adopted when the selection was on cooldown). */
  modelRef?: string;
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
  // R7: tool outputs reach the CLI verbatim unless the capability central edge
  // is handed a redactor — without this, secrets printed by a tool (env dumps,
  // git remotes with embedded tokens, …) stream to the client unmasked.
  #redactor = new Redactor();

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
      let resolved = await resolveChatModel(selection, request.userId);
      // Mirrors the chat stream's cooldown policy: if the selected model
      // tripped an upstream rate limit recently, adopt a healthy fallback
      // (free lane, then builtin default) instead of spending a retry cycle
      // against a limit that hasn't reset. When NO healthy alternative exists
      // the cooldown error surfaces — the user's explicit model choice wins
      // over silent replacement.
      const settings = await loadSettings(request.cwd ?? null);
      // Tracks the model this run will ACTUALLY use (after any cooldown
      // fallback swap) so a rate-limit failure below is recorded against the
      // right breaker key.
      let rlKey = modelKey(resolved.provider, resolved.modelId);
      const cooldown = checkCooldown(rlKey);
      let fallbackDetail: BridgeFallbackDetail | undefined;
      if (cooldown.onCooldown) {
        const fallback = selectHealthyFallbackModel(settings, rlKey);
        if (fallback) {
          const selectedWas = resolved.modelId;
          fallbackDetail = {
            from: selection.modelKind === "custom" ? selection.connectionId : selection.modelId,
            to: fallback.resolved.modelId,
            reason: `your selected model (${selectedWas}) is rate-limited (~${cooldown.retryAfterSeconds}s) — using ${fallback.resolved.modelId} for this run instead`,
          };
          resolved = fallback.resolved;
          rlKey = modelKey(resolved.provider, resolved.modelId);
        } else {
          throw new RateLimitCooldownError(resolved.modelId, cooldown.retryAfterSeconds);
        }
      }

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
        redactor: this.#redactor,
        observe: (event) => bridge.onStrategyEvent(event),
        bus,
      });

      const entry: ExecutionEntry = {
        ...entryBase,
        status: toSurfaceStatus(session.status),
        modelRef: fallbackDetail?.to ?? (selection.modelKind === "custom" ? selection.connectionId : selection.modelId),
        session: {
          cancel: (reason?: string) => session.cancel(reason),
          done: session.done,
        },
        bridge,
      };
      this.#executions.set(executionId, entry);

      // Fallback is a completed fact — it lands AFTER execution.started (the
      // engine's `started` event is emitted synchronously inside run()).
      if (fallbackDetail) bridge.onFallbackEngaged(fallbackDetail);

      void session.done.then((result) => {
        const live = this.#executions.get(executionId);
        if (live) live.status = result.status;
        // Learn rate-limit failures so the NEXT execution on this model fails
        // fast (or adopts a healthy fallback) instead of replaying the same
        // multi-attempt retry cycle against a quota that hasn't reset — the
        // execution path previously never tripped the breaker, unlike /chat.
        if (result.status === "failed") {
          const code = result.lastError?.code;
          const message = result.error ?? result.lastError?.message ?? "";
          if (
            code === "PROVIDER_RATE_LIMITED" ||
            !code && /rate.?limit|quota exceeded|\b429\b/i.test(message)
          ) {
            recordRateLimitFailure(rlKey);
          }
        }
        unsubscribe();
      });

      return entry;
    } catch (err) {
      // Resolution failed before a session existed — surface a terminal
      // `execution.failed` with a client-safe envelope so no SSE consumer
      // hangs on a silent execution and the reason is actionable, not a
      // blanket SYSTEM_UNKNOWN.
      const traceId = String(crypto.randomUUID());
      const { response } = clientErrorFrom(err, traceId);
      bridge.finish("failed", { clientError: response });
      const entry: ExecutionEntry = {
        ...entryBase,
        status: "failed",
        modelRef: request.model?.modelKind === "custom" ? request.model.connectionId : request.model?.modelId,
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

  /** Respond to a pending consent request (Phase 9). Scoped to one execution. */
  respondToConsent(
    userId: string,
    executionId: string,
    requestId: string,
    granted: boolean,
  ): boolean {
    const entry = this.get(userId, executionId);
    if (!entry) return false;
    return this.#consent.respond(executionId, requestId, granted);
  }

  #policy(allow: readonly RiskCategory[] | undefined): ApprovalPolicy {
    const policy = new ApprovalPolicy();
    for (const category of allow ?? []) policy.allow(category);
    return policy;
  }
}

/** Collapse the engine's rich lifecycle onto the wire's five-state surface:
 *  queued / waiting_approval / paused / checkpointed are all "live" while a
 *  run is still in flight, and the engine alone writes the terminal states. */
function toSurfaceStatus(status: ExecutionStatus): ExecutionEntry["status"] {
  switch (status) {
    case "created":
      return "created";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
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