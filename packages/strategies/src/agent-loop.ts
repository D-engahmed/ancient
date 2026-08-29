// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Agent-loop strategy (strategies) — rung 1. The workhorse: an iterative
// model↔tool loop that keeps running turns until the model stops requesting
// tools (or a turn budget runs dry). Direct (rung 0) is this cut down to a
// couple of turns; the loop is what scouts, plans, and edits do in practice.

import type { UsageTokens } from "@ANCIENT/infrastructure/providers";
import { sumUsage, EMPTY_USAGE } from "./util";
import type {
    ExecutionStrategy,
    ModelToolCall,
    StrategyEvent,
    StrategyRuntime,
    TaskProfile,
    TurnMessage,
} from "./types";

export const RUNG = 1 as const;
export const ID = "agent-loop" as const;

export const DEFAULT_MAX_TURNS = 10;

function matchFootnote(profile: TaskProfile): string | null {
    const c = profile.complexity ?? "moderate";
    if (c === "moderate") return "iterative work";
    if (profile.preferredStrategy === ID) return "explicitly preferred";
    return null;
}

export const agentLoopStrategy: ExecutionStrategy = {
    id: ID,
    rung: RUNG,
    wired: true,
    match: matchFootnote,
    async *execute({ profile, runtime }) {
        yield { type: "strategy-selected", id: ID, rung: RUNG, reason: "agent-loop" } as const;

        const tools = await runtime.listTools();
        const maxTurns = Math.max(1, DEFAULT_MAX_TURNS);
        const history: TurnMessage[] = [];
        let turnCount = 0;
        let toolCount = 0;
        let usage: UsageTokens = EMPTY_USAGE();

        try {
            while (turnCount < maxTurns) {
                const turn = await runtime.runModel({
                    system: SYSTEM,
                    prompt: `Task: ${profile.description}\n${profile.tools?.length ? `Tools available as needed.` : ""}`,
                    history,
                    tools,
                });

                turnCount += 1;
                usage = sumUsage(usage, turn.usage);
                if (turn.text) {
                    history.push({ role: "assistant", text: turn.text });
                    yield { type: "text-delta", text: turn.text } as const;
                }

                if (turn.toolCalls.length === 0) {
                    yield { type: "done", turnCount, toolCount, usage } as const;
                    return;
                }

                for (const call of turn.toolCalls) {
                    yield { type: "tool-call", call } as const;
                    toolCount += 1;
                    const result = await executeSafe(runtime, call);
                    history.push({ role: "user", text: `${call.name} → ${truncateForHistory(result)}` });
                    yield {
                        type: "tool-result",
                        callId: call.id,
                        result,
                        ...(result.startsWith("error: ") ? { error: result } : {}),
                    } as const;
                }
            }

            yield { type: "error", message: `agent-loop: reached max turns (${maxTurns})` } as const;
        } catch (err) {
            yield { type: "error", message: `agent-loop: ${err instanceof Error ? err.message : String(err)}` } as const;
        }

        yield { type: "done", turnCount, toolCount, usage } as const;
    },
};

const SYSTEM =
    "You are ANCIENT's agent loop. Work toward the task across turns. To inspect or change anything, call the tools. " +
    "Stop requesting tools and give the final answer when the task is complete.";

function truncateForHistory(text: string): string {
    return text.length > 2_000 ? text.slice(0, 2_000) + "…" : text;
}

async function executeSafe(runtime: StrategyRuntime, call: ModelToolCall): Promise<string> {
    try {
        return await runtime.executeTool(call);
    } catch (err) {
        return `error: ${err instanceof Error ? err.message : String(err)}`;
    }
}