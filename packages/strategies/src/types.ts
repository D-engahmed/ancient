// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Execution strategy contract (strategies).
//
// A strategy is a *leaf* way to drive model+tools toward a task goal
// (A-EXEC-001 → Change). Strategies never import the engine (A-LAYER-002):
// everything they need — model turns, tool execution, tool catalog — arrives
// through the `StrategyRuntime` port, which the engine implements from the
// capability registry + model runtime when it wires this layer in.

import type { z } from "zod";
import type { UsageTokens } from "@ANCIENT/infrastructure/providers";
import type { ModeType } from "@ANCIENT/shared";

/** The strategy ladder (§5 of ARCHITECTURE.md), cheapest rung first. */
export const STRATEGY_LADDER = [
    "direct",
    "agent-loop",
    "subagents",
    "teams",
    "arena",
] as const;

export type StrategyId = (typeof STRATEGY_LADDER)[number];
export type StrategyRung = 0 | 1 | 2 | 3 | 4;

export type ComplexityTier = "trivial" | "simple" | "moderate" | "complex" | "very-complex";

/** What the engine knows about the task before any execution. */
export type TaskProfile = {
    description: string;
    /** Caller/engine hint. Auto-inferred when absent (see selector). */
    complexity?: ComplexityTier;
    /** True when independent sub-goals can run concurrently. */
    parallelizable?: boolean;
    /** Rough expected input size, for cost-aware selection. */
    estimatedTokens?: number;
    /** Capability names the task is expected to exercise. */
    tools?: string[];
    mode?: ModeType;
    /** Explicit override — the engine's way to force a rung. */
    preferredStrategy?: StrategyId;
};

/** The selector's answer: which wired strategy, at which rung, why. */
export type StrategySelection = {
    id: StrategyId;
    rung: StrategyRung;
    reason: string;
};

/** A tool surfaced to a strategy by the runtime (already mode-gated). */
export type RuntimeTool = {
    name: string;
    description: string;
    inputSchema: z.ZodType;
};

export type ModelToolCall = {
    id: string;
    name: string;
    args: unknown;
};

export type ModelTurnResult = {
    /** Human-visible text produced this turn. */
    text: string;
    /** Tool calls the model wants executed; empty ⇒ the turn is final. */
    toolCalls: ModelToolCall[];
    usage?: UsageTokens;
};

export type TurnMessage = { role: "user" | "assistant"; text: string };

/**
 * Port the engine implements: model access (RUNTIMES' Model Runtime), tool
 * catalog, and tool execution (already run through the capability registry's
 * central edge — approval/consent/budget/redaction happen upstream, not here).
 */
export type StrategyRuntime = {
    listTools(): Promise<RuntimeTool[]>;
    runModel(input: {
        system?: string;
        prompt?: string;
        history?: TurnMessage[];
        tools?: RuntimeTool[];
    }): Promise<ModelTurnResult>;
    executeTool(call: ModelToolCall): Promise<string>;
};

/** Streamed outcome of one strategy execution. */
export type StrategyEvent =
    | { type: "strategy-selected"; id: StrategyId; rung: StrategyRung; reason: string }
    | { type: "text-delta"; text: string }
    | { type: "tool-call"; call: ModelToolCall }
    | { type: "tool-result"; callId: string; result: string; error?: string }
    | { type: "subtask"; subtaskId: string; goal: string; status: "created" | "completed" }
    | { type: "error"; message: string }
    | { type: "done"; summary?: string; turnCount: number; toolCount: number; usage: UsageTokens };

/**
 * A concrete execution strategy. `wired` declares whether it is runnable in
 * this build: teams/arena are catalogued (selector-aware) but unwired until
 * the engine runtime lands, so the selector never picks them. `execute`
 * yields a stream of StrategyEvents and must not throw.
 */
export interface ExecutionStrategy {
    readonly id: StrategyId;
    readonly rung: StrategyRung;
    readonly wired: boolean;
    /** Reason this strategy accepts the profile, or null. */
    match(profile: TaskProfile): string | null;
    execute(params: { profile: TaskProfile; runtime: StrategyRuntime }): AsyncIterable<StrategyEvent>;
}