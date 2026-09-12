// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Direct strategy (strategies) — rung 0. Runs the whole task as a bare
// minimum: one model turn, execute whatever tool calls it made, one
// continuation turn to land the answer. The cheapest reliable strategy
// (A-STRAT-001).

import type { UsageTokens } from "@ANCIENT/infrastructure/providers";
import { sumUsage, toolFeedbackText, EMPTY_USAGE } from "./util";
import { asEnvelope } from "./errors";
import { streamModelTurn } from "./model-stream";
import type {
    ExecutionStrategy,
    ModelToolCall,
    ModelTurnResult,
    StrategyEvent,
    StrategyRuntime,
    TaskProfile,
    ToolFailure,
    ToolResult,
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
        if (c === "trivial" || c === "simple") {
            return "low complexity";
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

        try {
            // Pass 1 — the whole task in one turn. Deltas stream live to the
            // engine as the model generates; the full result lands after.
            let pass1: ModelTurnResult;
            for await (const part of streamModelTurn(runtime, {
                system: "You are ANCIENT's direct executor. Complete the task using the tools, then give the final answer with no further tool calls.",
                prompt: `Task: ${profile.description}`,
                tools,
                history,
            })) {
                if (part.type === "delta") yield { type: "text-delta", text: part.text } as const;
                else pass1 = part.result;
            }

            turnCount += 1;
            usage = sumUsage(usage, pass1!.usage);

            // Record the pass-1 assistant turn with its tool calls so the tool
            // results below are call-attributed tool-role messages at pass 2
            // (ASSUMPTION-026), instead of text labeled as the assistant's own
            // prose — the status-quo bug this replaces.
            if (pass1!.toolCalls.length > 0 || pass1!.text.trim()) {
                history.push({ role: "assistant", text: pass1!.text, toolCalls: pass1!.toolCalls });
            }

            for (const call of pass1!.toolCalls) {
                yield { type: "tool-call", call } as const;
                toolCount += 1;
                const res = await executeSafe(runtime, call);
                history.push({ role: "tool", toolCallId: call.id, toolName: call.name, text: toolFeedbackText(res) });
                yield {
                    type: "tool-result",
                    callId: call.id,
                    result: res.text,
                    ...(res.failure ? { error: res.text, failure: res.failure } : {}),
                } as const;
            }

            // Pass 2 — one continuation to land the answer after observing
            // tools. Skipped entirely when pass 1 needed no tools: the task is
            // already complete and a second turn would only re-answer
            // pointlessly (the honesty rule — never mint turns you don't need).
            if (pass1!.toolCalls.length === 0) {
                yield { type: "done", turnCount, toolCount, usage } as const;
                return;
            }

            let pass2: ModelTurnResult;
            for await (const part of streamModelTurn(runtime, {
                system: "You are ANCIENT's direct executor. Land the final answer now.",
                prompt: `Task: ${profile.description}`,
                tools,
                history: [...history, { role: "user", text: "Tool results observed above. Give the final answer." }],
            })) {
                if (part.type === "delta") yield { type: "text-delta", text: part.text } as const;
                else pass2 = part.result;
            }

            turnCount += 1;
            usage = sumUsage(usage, pass2!.usage);
            for (const call of pass2!.toolCalls) {
                yield { type: "tool-call", call } as const;
                toolCount += 1;
                const res = await executeSafe(runtime, call);
                yield {
                    type: "tool-result",
                    callId: call.id,
                    result: res.text,
                    ...(res.failure ? { error: res.text, failure: res.failure } : {}),
                } as const;
            }

            yield { type: "done", turnCount, toolCount, usage } as const;
        } catch (err) {
            yield {
                type: "error",
                error: asEnvelope(err, {
                    code: "STRATEGY_UNRECOVERABLE",
                    domain: "strategy",
                    message: `direct: ${err instanceof Error ? err.message : String(err)}`,
                }),
            } as const;
            yield { type: "done", turnCount, toolCount, usage } as const;
        }
    },
};

async function executeSafe(runtime: StrategyRuntime, call: { id: string; name: string; args: unknown }): Promise<ToolResult> {
    try {
        return await runtime.executeTool(call);
    } catch (err) {
        const failure: ToolFailure = {
            code: "CAPABILITY_EXECUTION_FAILED",
            message: err instanceof Error ? err.message : String(err),
            transient: false,
            retryableAsIs: false,
            partialEffect: "unknown",
        };
        return { text: `error: ${failure.message}`, ok: false, failure };
    }
}