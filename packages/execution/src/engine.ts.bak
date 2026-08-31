// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Execution engine (engine/engine) — the UNIFIED EXECUTION ENGINE (docs/03):
//
//   task → profiler (Context Runtime) → strategy selector → strategy stream
//          → StrategyRuntime (engine/runtime)
//
// LIFECYCLE MANAGER (docs/03 §3.1): the engine is the ONLY writer of terminal
// status (`completed|failed|cancelled`). Strategies and capabilities REPORT
// failures upward as typed ErrorEnvelopes (Layer 20) and never set terminal
// state; the engine classifies each failure (retryable-vs-terminal) and is
// the only component allowed to write `Failed` (§state diagram: Failed → Queued
// happens ONLY for transient, bounded retries — never for a bad tool argument
// or a policy denial).
//
// Lifecycle events are published onto the infra EventBus in the durable event
// shapes (so the gateway can bridge to the durable store / checkpoints later —
// A-EXEC-003); strategy events (text-delta, tool-call, tool-result, subtask)
// are recorded per session for replay. Cancellation stops the engine consuming
// the strategy stream; an in-flight tool call is allowed to finish (the honest
// primitive).

import { MemoryEventBus, type EventBus, type LifecycleEventType } from "@ANCIENT/infrastructure/events";
import {
  strategyCatalog,
  StrategySelector,
  asEnvelope,
  RUNG_CEILING,
  type StrategyEvent,
  type StrategyRuntime,
  type StrategySelection,
  type TaskProfile,
} from "@ANCIENT/strategies";
import type { CapabilityRegistry } from "@ANCIENT/capabilities/core";
import { isTransientCode, makeError, type ErrorEnvelope, type RetryBudget } from "@ANCIENT/contracts";
import { nextDelay } from "@ANCIENT/reliability";
import type {
    ExecutionSession,
    ExecutionStatus,
    RunRequest,
    RunResult,
} from "./types";
import { inferProfile } from "./profiler";
import { createStrategyRuntime } from "./runtime";
import { createContext } from "./context";
import { randomUUID as createId } from "node:crypto";
import type { StrategyRung, ComplexityTier } from "@ANCIENT/strategies";

/** Default transient-retry budget (Layer 12 §4). Conservative: two attempts. */
export const DEFAULT_RETRY_BUDGET: RetryBudget = {
    maxAttempts: 2,
    baseDelayMs: 250,
    maxDelayMs: 4_000,
    jitter: true,
    backoffMultiplier: 2,
};

/** Bounded re-selection (docs/03 §3.5): at most ONE escalation per run. */
export const RESELECTION_LIMIT = 1;

export class ExecutionEngine {
    #bus: EventBus;
    readonly registry: CapabilityRegistry;
    readonly selector: StrategySelector;

    constructor(opts: { registry: CapabilityRegistry; bus?: EventBus; selector?: StrategySelector }) {
        this.registry = opts.registry;
        this.selector = opts.selector ?? new StrategySelector();
        this.#bus = opts.bus ?? new MemoryEventBus();
    }

    get bus(): EventBus {
        return this.#bus;
    }

    /** Start a run. The returned session is live immediately; `session.done`
     *  settles when the run completes, fails, or is cancelled. */
    run(request: RunRequest): ExecutionSession {
        const session = new EngineSession(request.bus ?? this.#bus, request, request.sessionId);
        void this.#drive(session, request);
        return session;
    }

    /** Rollup produced by consuming one strategy stream (one attempt). */
    async #consume(
        session: EngineSession,
        request: RunRequest,
        strategy: { execute(opts: { profile: TaskProfile; runtime: StrategyRuntime }): AsyncIterable<StrategyEvent> },
        profile: TaskProfile,
        runtime: StrategyRuntime,
    ): Promise<ConsumeOutcome> {
        let turnCount = 0;
        let toolCount = 0;
        let usage = { inputTokens: 0, outputTokens: 0 };
        const outputChunks: string[] = [];
        let summary: string | undefined;
        let error: ErrorEnvelope | undefined;
        const pendingBounds = new Map<string, string>();

        try {
            for await (const event of strategy.execute({ profile, runtime })) {
                if (session.cancelled) break;
                session.record(event);
                request.observe?.(event);

                switch (event.type) {
                    case "text-delta":
                        outputChunks.push(event.text);
                        break;
                    case "tool-call":
                        pendingBounds.set(event.call.id, event.call.name);
                        break;
                    case "tool-result": {
                        toolCount += 1;
                        session.publish("tool-executed", {
                            tool: pendingBounds.get(event.callId) ?? "?",
                            ok: !event.error,
                            // Layer 20: surface the typed failure (code +
                            // retryability) so the CLI can help the user.
                            ...(event.error ? { error: event.error, code: event.failure?.code } : {}),
                        });
                        break;
                    }
                    case "error":
                        // First error wins — preserve the root cause (Layer 20).
                        error ??= event.error;
                        break;
                    case "done":
                        turnCount = event.turnCount;
                        toolCount = event.toolCount;
                        usage = event.usage;
                        summary = event.summary;
                        break;
                    default:
                        break;
                }
            }
        } catch (err) {
            // A strategy that throws violates its contract — surface it typed
            // (Layer 20 §1) instead of leaking a raw exception to the gateway.
            error ??= asEnvelope(err, {
                code: "STRATEGY_UNRECOVERABLE",
                domain: "engine",
                message: `engine: strategy threw — ${err instanceof Error ? err.message : String(err)}`,
            });
        }

        return {
            error,
            turnCount,
            toolCount,
            usage,
            output: outputChunks.join(""),
            summary,
        };
    }

    /** Terminal-failed settle. Called only for non-retryable classifications. */
    #fail(session: EngineSession, selection: StrategySelection, retryCount: number, error: ErrorEnvelope, outcome: ConsumeOutcome): void {
        session.status = "failed";
        session.publish("failed", { message: error.message, error, terminal: "failed" });
        session.resolve({
            sessionId: session.id,
            status: "failed",
            strategy: selection,
            turnCount: outcome.turnCount,
            toolCount: outcome.toolCount,
            usage: outcome.usage,
            retryCount,
            ...(outcome.output ? { output: outcome.output } : {}),
            ...(outcome.summary ? { summary: outcome.summary } : {}),
            error: error.message,
            lastError: error,
        });
    }

    async #drive(session: EngineSession, request: RunRequest): Promise<void> {
        const { task, scope, policy, model, mode = "BUILD" } = request;
        session.publish("created", { task: task.slice(0, 240), mode });
        session.status = "queued"; // Created → Queued → Running (docs/03 state diagram)

        const profile: TaskProfile = inferProfile(task, mode, request.profile);
        let selection = this.selector.select(profile);
        // Engine-owned context (A-ENG-002): pre-rendered blocks + budgets from
        // the request; identity/mode/cwd/date come from the run itself.
        const context = createContext({
            task,
            mode,
            cwd: scope.cwd ?? undefined,
            today: new Date().toISOString().slice(0, 10),
            blocks: request.context?.blocks,
            budgets: request.context?.budgets,
            systemBudget: request.context?.systemBudget,
            historyBudget: request.context?.historyBudget,
        });
        const runtime = createStrategyRuntime({
            registry: this.registry,
            scope,
            model,
            mode,
            allow: request.allow,
            policy,
            consentProvider: request.consentProvider,
            redactor: request.redactor,
            context,
        });

        let strategy = strategyCatalog.find((s) => s.id === selection.id);
        if (!strategy) {
            const missing = makeError({
                code: "STRATEGY_UNRECOVERABLE",
                domain: "engine",
                message: `engine: strategy '${selection.id}' not found in catalog`,
            });
            this.#fail(session, selection, 0, missing, EMPTY_OUTCOME);
            return;
        }
        session.publish("started", {
            strategy: selection.id,
            rung: selection.rung,
            reason: selection.reason,
        });
        session.status = "running";

        const budget: RetryBudget = request.retryBudget ?? DEFAULT_RETRY_BUDGET;
        let lastError: ErrorEnvelope | undefined;
        let retryCount = 0;
        let reselectionCount = 0;
        let outcome: ConsumeOutcome = EMPTY_OUTCOME;
        // Across re-selections a run's totals are cumulative: the direct pass
        // that ran a tool via then escalated still counts that tool.
        let totalTurnCount = 0;
        let totalToolCount = 0;
        let totalUsage = { inputTokens: 0, outputTokens: 0 };

        for (let attempt = 1; attempt <= budget.maxAttempts; attempt++) {
            outcome = await this.#consume(session, request, strategy, profile, runtime);
            totalTurnCount += outcome.turnCount;
            totalToolCount += outcome.toolCount;
            totalUsage = {
                inputTokens: totalUsage.inputTokens + outcome.usage.inputTokens,
                outputTokens: totalUsage.outputTokens + outcome.usage.outputTokens,
            };

            if (session.cancelled) break;

            if (!outcome.error) {
                // Quality gate ("cheapest RELIABLE", A-STRAT-001): a run that
                // only used tools and produced no final text is INCOMPLETE, not
                // a success. Escalate up the ladder once (bounded, docs/03 §3.5)
                // before accepting it — this is what turned "analyze the whole
                // system" into an empty answer in the field.
                const emptyAfterTools = outcome.toolCount > 0 && outcome.output.trim().length === 0;
                if (emptyAfterTools && reselectionCount < RESELECTION_LIMIT) {
                    reselectionCount += 1;
                    session.status = "queued";
                    session.publish("degraded", {
                        reason: "empty-output",
                        reselection: reselectionCount,
                        from: selection.id,
                    });

                    // Re-profile at the next tier so a heavier, previously
                    // non-accepting strategy becomes a legitimate candidate.
                    const nextRung = Math.min(selection.rung + 1, 4) as StrategyRung;
                    const next = this.selector.select(
                        { ...profile, complexity: RUNG_CEILING[nextRung] },
                        { minRung: nextRung },
                    );
                    if (next.id !== selection.id && next.rung > selection.rung) {
                        selection = next;
                        strategy = strategyCatalog.find((s) => s.id === selection.id);
                        if (!strategy) {
                            const missing = makeError({
                                code: "STRATEGY_UNRECOVERABLE",
                                domain: "engine",
                                message: `engine: strategy '${selection.id}' not found in catalog`,
                            });
                            this.#fail(session, selection, retryCount, missing, EMPTY_OUTCOME);
                            return;
                        }
                        session.publish("started", {
                            strategy: selection.id,
                            rung: selection.rung,
                            reason: selection.reason,
                        });
                        session.status = "running";
                        attempt = 0; // full retry budget for the escalated strategy
                        continue;
                    }
                    // No heavier wired strategy exists — accept the honest empty
                    // answer rather than fabricate one or loop forever.
                    session.status = "running";
                }

                // Graceful completion — terminal, written by the engine.
                session.status = "completed";
                session.publish("completed", {
                    turnCount: totalTurnCount,
                    toolCount: totalToolCount,
                    usage: totalUsage,
                    ...(outcome.summary ? { summary: outcome.summary } : {}),
                });
                session.resolve({
                    sessionId: session.id,
                    status: "completed",
                    strategy: selection,
                    turnCount: totalTurnCount,
                    toolCount: totalToolCount,
                    usage: totalUsage,
                    retryCount,
                    ...(outcome.output ? { output: outcome.output } : {}),
                    ...(outcome.summary ? { summary: outcome.summary } : {}),
                });
                return;
            }

            // Failure classification (docs/03 Failed→Queued edge + Layer 20 §3):
            // only TRANSIENT codes get a bounded retry; terminal codes always
            // settle. On the final attempt even transient errors go terminal.
            lastError = outcome.error;
            const retryable = isTransientCode(outcome.error.code) && attempt < budget.maxAttempts;
            if (retryable) {
                const waitMs = nextDelay(attempt, budget);
                retryCount = attempt;
                session.status = "queued";
                session.publish("retrying", {
                    attempt: attempt + 1,
                    waitMs,
                    code: outcome.error.code,
                    message: outcome.error.message,
                });
                await new Promise<void>((r) => setTimeout(r, waitMs));
                session.status = "running";
                continue;
            }

            this.#fail(session, selection, retryCount, outcome.error, outcome);
            return;
        }

        // Budget exhausted (all attempts transient or cancelled mid-retry).
        if (session.cancelled) {
            const cancelMessage = session.cancelReason ?? "cancelled";
            session.status = "cancelled";
            session.publish("failed", { reason: "cancelled", message: cancelMessage, terminal: "cancelled" });
            session.resolve({
                sessionId: session.id,
                status: "cancelled",
                strategy: selection,
                turnCount: totalTurnCount,
                toolCount: totalToolCount,
                usage: totalUsage,
                retryCount,
                ...(outcome.output ? { output: outcome.output } : {}),
                ...(outcome.summary ? { summary: outcome.summary } : {}),
                error: cancelMessage,
            });
            return;
        }
        this.#fail(session, selection, retryCount, lastError ?? EMPTY_OUTCOME.error!, outcome);
    }
}
const EMPTY_OUTCOME: ConsumeOutcome = {
    error: undefined,
    turnCount: 0,
    toolCount: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    output: "",
    summary: undefined,
};

type ConsumeOutcome = {
    error?: ErrorEnvelope;
    turnCount: number;
    toolCount: number;
    usage: { inputTokens: number; outputTokens: number };
    output: string;
    summary?: string;
};

export class EngineSession implements ExecutionSession {
    readonly id: string;
    /** Live surface — the gateway collapses to {created,running,completed,
     *  failed,cancelled} but the engine writes `queued` while retrying or
     *  awaiting its strategy slot (docs/03 state diagram). */
    status: ExecutionStatus = "created";
    readonly done: Promise<RunResult>;

    #seq = 0;
    #log: StrategyEvent[] = [];
    #cancelRequested = false;
    cancelReason: string | undefined;
    #resolve!: (result: RunResult) => void;

    constructor(
        private readonly bus: EventBus,
        private readonly request: RunRequest,
        id?: string,
    ) {
        this.id = id ?? createId();
        this.done = new Promise<RunResult>((resolve) => {
            this.#resolve = resolve;
        });
    }

    get cancelled(): boolean {
        return this.#cancelRequested;
    }

    publish(type: LifecycleEventType, payload?: Record<string, unknown>): void {
        this.bus.publish({
            id: createId(),
            executionId: this.id,
            seq: ++this.#seq,
            type,
            timestamp: new Date(),
            payload,
        });
    }

    record(event: StrategyEvent): void {
        this.#log.push(event);
    }

    events(): readonly StrategyEvent[] {
        return this.#log;
    }

    cancel(reason?: string): void {
        // Acceptable while live — incl. retry backoff (`queued`), where the
        // engine checks `cancelled` before every attempt and settles terminal.
        if (this.status === "running" || this.status === "queued") {
            this.#cancelRequested = true;
            this.cancelReason = reason ?? "cancelled";
        }
    }

    resolve(result: RunResult): void {
        this.#resolve(result);
    }
}