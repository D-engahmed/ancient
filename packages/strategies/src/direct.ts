// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Direct strategy (strategies) — rung 0. Runs the whole task as a bare
// minimum: one model turn, execute whatever tool calls it made, one
// continuation turn to land the answer. The cheapest reliable strategy
// (A-STRAT-001).

import type { UsageTokens } from "@ANCIENT/infrastructure/providers";
import { sumUsage, EMPTY_USAGE } from "./util";
import type {
    ExecutionStrategy,
    ModelTurnResult,
    StrategyEvent,
    StrategyRuntime,
    TaskProfile,
    TurnMessage,
} from "./types";

export const RUNG = 0 as const;
export const ID = "direct" as const;

export const directStrategy: ExecutionStrategy = {
    id: ID,
    rung: RUNG,
    wired: true,
    match: (profile) => {
        const c = profile.complexity ?? "simple";
        if (c === "trivial" || c === "simple" || (c === "moderate" && !profile.parallelizable && !profile.tools?.length)) {
            return "low complexity, no parallelism";
        }
        return null;
    },
    async *execute({ profile, runtime }) {
        yield { type: "strategy-selected", id: ID, rung: RUNG, reason: "direct" } as const;

        const tools = await runtime.listTools();
        let turnCount = 0;
        let toolCount = 0;
        let usage: UsageTokens = EMPTY_USAGE();
        const history: TurnMessage[] = [];

        // Pass 1 — the whole task in one turn.
        const pass1 = await safeTurn(runtime, {
            system: "You are ANCIENT's direct executor. Complete the task using the tools, then give the final answer with no further tool calls.",
            prompt: `Task: ${profile.description}`,
            tools,
            history,
        });

        if (!pass1.ok) {
            yield { type: "error", message: pass1.message } as const;
            yield { type: "done", turnCount, toolCount, usage } as const;
            return;
        }

        turnCount += 1;
        usage = sumUsage(usage, pass1.result.usage);
        yield { type: "text-delta", text: pass1.result.text } as const;

        for (const call of pass1.result.toolCalls) {
            yield { type: "tool-call", call } as const;
            toolCount += 1;
            const out = await executeSafe(runtime, call);
            history.push({ role: "assistant", text: `${call.name} → ${out}` });
            yield {
                type: "tool-result",
                callId: call.id,
                result: out,
                ...(out.startsWith("error: ") ? { error: out } : {}),
            } as const;
        }

        // Pass 2 — one continuation to land the answer after observing tools.
        // Skipped entirely when pass 1 needed no tools: the task is already
        // complete and a second turn would only re-answer pointlessly (the
        // honesty rule — never mint turns you don't need).
        if (pass1.result.toolCalls.length === 0) {
            yield { type: "done", turnCount, toolCount, usage } as const;
            return;
        }

        const pass2 = await safeTurn(runtime, {
            system: "You are ANCIENT's direct executor. Land the final answer now.",
            prompt: `Task: ${profile.description}`,
            tools,
            history: [...history, { role: "user", text: "Tool results observed above. Give the final answer." }],
        });

        if (pass2.ok) {
            turnCount += 1;
            usage = sumUsage(usage, pass2.result.usage);
            yield { type: "text-delta", text: pass2.result.text } as const;
            for (const call of pass2.result.toolCalls) {
                yield { type: "tool-call", call } as const;
                toolCount += 1;
                yield { type: "tool-result", callId: call.id, result: await executeSafe(runtime, call) } as const;
            }
        } else {
            yield { type: "error", message: pass2.message } as const;
        }

        yield { type: "done", turnCount, toolCount, usage } as const;
    },
};

async function safeTurn(
    runtime: StrategyRuntime,
    input: Parameters<StrategyRuntime["runModel"]>[0],
): Promise<{ ok: true; result: ModelTurnResult } | { ok: false; message: string }> {
    try {
        return { ok: true, result: await runtime.runModel(input) };
    } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
}

async function executeSafe(runtime: StrategyRuntime, call: { id: string; name: string; args: unknown }): Promise<string> {
    try {
        return await runtime.executeTool(call);
    } catch (err) {
        return `error: ${err instanceof Error ? err.message : String(err)}`;
    }
}