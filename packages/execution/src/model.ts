// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Model chat adapter (engine/model) — turns an AI-SDK LanguageModel into the
// engine's ModelChat port. It runs exactly ONE model step per call: the tools
// handed in are used for schema/signaling only, and the strategy loop (not the
// SDK) decides what to execute and when. Tool execution stays on the engine's
// StrategyRuntime, which owns the central capability edge (approval/consent/
// budget/redaction) — the SDK never executes a tool itself.

import { generateText, stepCountIs, APICallError, RetryError } from "ai";
import type { LanguageModel, ModelMessage, Tool, ToolSet } from "ai";
import { makeError, type ErrorEnvelope } from "@ANCIENT/contracts";
import type { ModelChat } from "./types";

type ChatTool = { name: string; description: string; inputSchema: unknown };

/**
 * Classify a model-port failure into a canonical ErrorEnvelope (Layer 20).
 * The AI SDK wraps upstream failures in RetryError ("Failed after 3 attempts.
 * Last error: AI_APICallError: …") which no strategy can classify — left
 * as-is every provider outage, rate limit, and bad key became a generic
 * STRATEGY_UNRECOVERABLE, so the engine retried dead models and the CLI
 * showed meaningless errors. Duck-type the wrapper (class identity doesn't
 * survive SDK retry wrapping; the .lastError property does) and map by HTTP
 * status, mirroring the chat route's rate-limit handling.
 */
function envelopeFromModelError(err: unknown): ErrorEnvelope | undefined {
    const unwrapped = RetryError.isInstance(err) ? err.lastError : err;
    if (!APICallError.isInstance(unwrapped)) return undefined;

    const status = typeof unwrapped.statusCode === "number" ? unwrapped.statusCode : undefined;
    const message = unwrapped.message || "provider request failed";
    if (status === 429) {
        return makeError({
            code: "PROVIDER_RATE_LIMITED",
            domain: "provider",
            message,
            transient: true,
        });
    }
    if (status === 401 || status === 403) {
        return makeError({
            code: "PROVIDER_AUTH_FAILED",
            domain: "provider",
            message,
            transient: false,
        });
    }
    if (status === 408 || (status !== undefined && status >= 500)) {
        return makeError({
            code: "PROVIDER_UNAVAILABLE",
            domain: "provider",
            message,
            transient: true,
        });
    }
    // 400/404/etc — a bad request or a nonexistent model id will not heal.
    return makeError({
        code: "PROVIDER_UNAVAILABLE",
        domain: "provider",
        message,
        transient: false,
    });
}

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
            // The engine owns retrying (DEFAULT_RETRY_BUDGET, with backoff and
            // cooldown fallback at the gateway). SDK-level retries would only
            // multiply upstream calls — a quota-limited model saw 3 SDK
            // attempts × the engine's budget before anyone saw an error.
            maxRetries: 0,
        };
        // generateText discriminates on messages vs prompt; pick one arm explicitly.
        const hasHistory = messages.length > 0;
        let result;
        try {
            result = hasHistory
                ? await generateText({ ...base, messages })
                : await generateText({ ...base, prompt: input.prompt ?? "" });
        } catch (err) {
            const envelope = envelopeFromModelError(err);
            if (envelope) throw envelope;
            throw err;
        }

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