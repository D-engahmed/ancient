// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Test-only fakes for strategy tests (not exported from the package root).

import type { ModelTurnResult, RuntimeTool, StrategyRuntime, TurnMessage } from "./types";

export type FakeTurn = ModelTurnResult | ((history: TurnMessage[]) => ModelTurnResult);

/** A scriptable StrategyRuntime: consume pre-arranged turns, record calls. */
export function fakeRuntime(opts: {
    turns: FakeTurn[];
    exec?: (call: { name: string; args: unknown }) => string | Promise<string>;
    tools?: RuntimeTool[];
    failOnRun?: boolean;
}): StrategyRuntime & { calls: { name: string; args: unknown }[] } {
    const calls: { name: string; args: unknown }[] = [];
    let cursor = 0;

    return {
        calls,
        async listTools() {
            return opts.tools ?? [];
        },
        async runModel(input) {
            if (opts.failOnRun) throw new Error("model failure");
            const entry = opts.turns[Math.min(cursor, opts.turns.length - 1)]!;
            cursor += 1;
            if (typeof entry === "function") return entry(input.history ?? []);
            return entry;
        },
        async executeTool(call) {
            calls.push(call);
            if (opts.exec) return opts.exec(call);
            return `ok:${call.name}`;
        },
    };
}

export function turn(
    text: string,
    toolCalls: ModelTurnResult["toolCalls"] = [],
    usage: ModelTurnResult["usage"] = { inputTokens: 10, outputTokens: 5 },
): ModelTurnResult {
    return { text, toolCalls, usage };
}

export function call(name: string, args: unknown = {}, id = `c-${Math.random().toString(36).slice(2, 8)}`): ModelTurnResult["toolCalls"][number] {
    return { id, name, args };
}