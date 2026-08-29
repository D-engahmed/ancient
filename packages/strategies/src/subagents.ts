// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Subagents strategy (strategies) — rung 2. Plan-then-delegate: ask the model
// to decompose the task into independent subtasks, then run each subtask as a
// bounded agent loop. Concurrency of subtask execution is the engine's choice
// (it consumes this stream); here subtasks run sequentially and interleave.

import type { UsageTokens } from "@ANCIENT/infrastructure/providers";
import { extractJson, sumUsage, EMPTY_USAGE } from "./util";
import { agentLoopStrategy } from "./agent-loop";
import type { ExecutionStrategy, ModelToolCall, StrategyEvent, StrategyRuntime, TaskProfile } from "./types";

export const RUNG = 2 as const;
export const ID = "subagents" as const;

export const MAX_SUBTASKS = 8;

type Subtask = { goal: string; context?: string };

export const subagentsStrategy: ExecutionStrategy = {
    id: ID,
    rung: RUNG,
    wired: true,
    match: (profile) => {
        if (profile.preferredStrategy === ID) return "explicitly preferred";
        const c = profile.complexity ?? "complex";
        if (c === "complex" || c === "very-complex" || (profile.parallelizable && c !== "trivial")) {
            return "decomposable work";
        }
        return null;
    },
    async *execute({ profile, runtime }) {
        yield { type: "strategy-selected", id: ID, rung: RUNG, reason: "subagents" } as const;

        const tools = await runtime.listTools();
        let toolCount = 0;
        let usage: UsageTokens = EMPTY_USAGE();
        let plan: Subtask[];
        try {
            const planTurn = await runtime.runModel({
                system:
                    "You are ANCIENT's task planner. Decompose the task into a JSON object " +
                    `{"subtasks":[{"goal":"...","context":"..."}]} with between 1 and ${MAX_SUBTASKS} subtasks. ` +
                    "Output ONLY the JSON.",
                prompt: `Task: ${profile.description}`,
                tools,
            });
            usage = sumUsage(usage, planTurn.usage);
            const parsed = extractJson(planTurn.text);
            plan = parseSubtasks(parsed);
            if (plan.length === 0) throw new Error("empty subtask plan");
        } catch (err) {
            yield {
                type: "error",
                message: `subagents: planning failed (${err instanceof Error ? err.message : String(err)})`,
            } as const;
            yield { type: "done", turnCount: 1, toolCount, usage } as const;
            return;
        }

        let subtaskIndex = 0;
        for (const subtask of plan) {
            subtaskIndex += 1;
            const subtaskId = `st-${subtaskIndex}`;
            yield { type: "subtask", subtaskId, goal: subtask.goal, status: "created" } as const;

            const subProfile: TaskProfile = {
                description:
                    `Original task: ${profile.description}\n` +
                    `Subtask ${subtaskIndex}/${plan.length}: ${subtask.goal}` +
                    (subtask.context ? `\nContext: ${subtask.context}` : ""),
                complexity: "simple",
            };

            for await (const event of agentLoopStrategy.execute({ profile: subProfile, runtime })) {
                if (event.type === "tool-result") toolCount += 1;
                yield event;
                if (event.type === "done" && event.usage) usage = sumUsage(usage, event.usage);
            }

            yield { type: "subtask", subtaskId, goal: subtask.goal, status: "completed" } as const;
        }

        yield { type: "done", turnCount: 1, toolCount, usage, summary: `${plan.length} subtask(s) completed` } as const;
    },
};

function parseSubtasks(parsed: unknown): Subtask[] {
    if (typeof parsed !== "object" || parsed === null) return [];
    const list = (parsed as { subtasks?: unknown }).subtasks;
    if (!Array.isArray(list)) return [];
    const clean: Subtask[] = [];
    for (const item of list) {
        if (typeof item !== "object" || item === null) continue;
        const goal = (item as { goal?: unknown }).goal;
        if (typeof goal !== "string" || goal.trim() === "") continue;
        const context = (item as { context?: unknown }).context;
        clean.push({ goal: goal.trim(), context: typeof context === "string" ? context : undefined });
        if (clean.length >= MAX_SUBTASKS) break;
    }
    return clean;
}