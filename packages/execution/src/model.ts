// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Model chat adapter (engine/model) — turns an AI-SDK LanguageModel into the
// engine's ModelChat port. It runs exactly ONE model step per call: the tools
// handed in are used for schema/signaling only, and the strategy loop (not the
// SDK) decides what to execute and when. Tool execution stays on the engine's
// StrategyRuntime, which owns the central capability edge (approval/consent/
// budget/redaction) — the SDK never executes a tool itself.

import { generateText, stepCountIs } from "ai";
import type { LanguageModel, ModelMessage, Tool, ToolSet } from "ai";
import type { ModelChat } from "./types";

type ChatTool = { name: string; description: string; inputSchema: unknown };

/** One model step returning raw text + tool calls + usage (never executes tools). */
export function createAiModelChat(model: LanguageModel): ModelChat {
    return async (input) => {
        const messages: ModelMessage[] = (input.history ?? []).map((m) => ({
            role: m.role,
            content: [{ type: "text", text: m.text }],
        }));

        if (input.history && input.history.length > 0) {
            messages.push({ role: "user", content: [{ type: "text", text: input.prompt ?? "" }] });
        }

        const base = {
            model,
            system: input.system,
            tools: input.tools ? toToolSet(input.tools) : undefined,
            stopWhen: stepCountIs(1),
        };
        // generateText discriminates on messages vs prompt; pick one arm explicitly.
        const hasHistory = messages.length > 0;
        const result = hasHistory
            ? await generateText({ ...base, messages })
            : await generateText({ ...base, prompt: input.prompt ?? "" });

        return {
            text: result.text ?? "",
            toolCalls: result.toolCalls.map((call) => ({
                id: call.toolCallId,
                name: call.toolName,
                args: (call as { input: unknown }).input ?? {},
            })),
            usage: {
                inputTokens: result.usage?.inputTokens ?? 0,
                outputTokens: result.usage?.outputTokens ?? 0,
            },
        };
    };
}

/** Schema-only tool set: `execute` is a stub the (single-step) SDK never calls. */
function toToolSet(tools: readonly ChatTool[]): ToolSet {
    const sdk: ToolSet = {};
    for (const t of tools) {
        sdk[t.name] = {
            description: t.description,
            inputSchema: t.inputSchema,
            execute: async () => "engine executes tools centrally (single-step model turn)",
        } as Tool;
    }
    return sdk;
}