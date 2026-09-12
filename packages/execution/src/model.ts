// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Model chat adapter (engine/model) — turns an AI-SDK LanguageModel into the
// engine's ModelChat port. It runs exactly ONE model step per call: the tools
// handed in are used for schema/signaling only, and the strategy loop (not the
// SDK) decides what to execute and when. Tool execution stays on the engine's
// StrategyRuntime, which owns the central capability edge (approval/consent/
// budget/redaction) — the SDK never executes a tool itself.

import { streamText, stepCountIs } from "ai";
import type { LanguageModel, ModelMessage, Tool, ToolSet } from "ai";
import { makeError, type ErrorEnvelope } from "@ANCIENT/contracts";
import type { TurnMessage } from "@ANCIENT/strategies";
import type { ModelChat } from "./types";

type ChatTool = { name: string; description: string; inputSchema: unknown };

/**
 * Classify a model-port failure into a canonical ErrorEnvelope (Layer 20).
 * Two traps make class-identity checks unusable here:
 *   1. The AI SDK re-exports APICallError from "ai", but streamText throws
 *      instances built by the underlying @ai-sdk/provider-utils package —
 *      a different class that fails `instanceof`/`isInstance` both ways.
 *   2. In some failure paths the SDK rejects the awaited result with a generic
 *      NoOutputGeneratedError instead of the provider error, so the real
 *      status is only visible on the stream's onError handler (of which the
 *      caller passes a capture — see createAiModelChat).
 * So: duck-type the error by SHAPE (a numeric statusCode), and let the caller
 * supply the onError-captured root as a fallback source.
 */
export function envelopeFromModelError(err: unknown): ErrorEnvelope | undefined {
    let current: unknown = err;
    // Unwrap the SDK's RetryError wrapper ("Failed after 3 attempts…").
    if (current && typeof current === "object" && "lastError" in current) {
        current = (current as { lastError: unknown }).lastError;
    }
    if (!current || typeof current !== "object") return undefined;
    const status = (current as { statusCode?: unknown }).statusCode;
    if (typeof status !== "number") return undefined;

    // Provider messages can embed the API key verbatim (OpenAI masks it,
    // others may not) — the durable trace would persist it. Record a
    // status-based reason only; the raw error stays in the log, not the
    // envelope.
    if (status === 429) {
        return makeError({
            code: "PROVIDER_RATE_LIMITED",
            domain: "provider",
            message: "provider rate-limited (429)",
            transient: true,
            retryableAsIs: true,
        });
    }
    if (status === 401 || status === 403) {
        return makeError({
            code: "PROVIDER_AUTH_FAILED",
            domain: "provider",
            message: "provider rejected the supplied credentials",
            transient: false,
        });
    }
    if (status === 408 || status >= 500) {
        return makeError({
            code: "PROVIDER_UNAVAILABLE",
            domain: "provider",
            message: `provider request failed (HTTP ${status})`,
            transient: true,
        });
    }
    return makeError({
        code: "PROVIDER_UNAVAILABLE",
        domain: "provider",
        message: `provider request failed (HTTP ${status})`,
        transient: false,
    });
}

/**
 * Replay recorded turns as native provider messages (ASSUMPTION-026).
 * Assistant turns that requested tools carry their tool-call parts; each
 * executed result becomes a `tool` message whose `tool-result` part is
 * attributed to the call id it answered. Plain user/assistant turns stay
 * text parts. This is the model's own tool protocol — providers were trained
 * on call→result attribution, so retry/abandon and output-reuse decisions
 * are better than with concatenated `"tool → output"` text.
 */
export function historyToModelMessages(history: readonly TurnMessage[]): ModelMessage[] {
    const messages: ModelMessage[] = [];
    for (const m of history) {
        if (m.role === "tool") {
            messages.push({
                role: "tool",
                content: [
                    {
                        type: "tool-result",
                        toolCallId: m.toolCallId,
                        toolName: m.toolName,
                        output: { type: "text", value: m.text },
                    },
                ],
            });
            continue;
        }
        if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
            const content: Array<
                | { type: "text"; text: string }
                | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
            > = [];
            if (m.text) content.push({ type: "text", text: m.text });
            for (const call of m.toolCalls) {
                content.push({ type: "tool-call", toolCallId: call.id, toolName: call.name, input: call.args ?? {} });
            }
            messages.push({ role: "assistant", content });
            continue;
        }
        messages.push({ role: m.role, content: [{ type: "text", text: m.text }] });
    }
    return messages;
}

/** One model step returning raw text + tool calls + usage (never executes tools). */
export function createAiModelChat(model: LanguageModel): ModelChat {
    return async (input) => {
        const messages = historyToModelMessages(input.history ?? []);

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
            // The SDK's default stream error handler dumps the raw provider
            // error (headers, cookies, response body) to console.error for
            // every failing turn. Silence it — we read the error off the full
            // stream below and classify it into one clean typed envelope.
            onError: () => {},
        };
        // streamText discriminates on messages vs prompt; pick one arm explicitly.
        const hasHistory = messages.length > 0;
        let streamError: unknown;
        try {
            const result = hasHistory
                ? streamText({ ...base, messages })
                : streamText({ ...base, prompt: input.prompt ?? "" });

            // Consume the FULL stream, not textStream: v7 delivers a provider
            // failure as a `{ type: "error" }` part while the awaited
            // result.text rejects with a generic NoOutputGeneratedError that
            // carries no status (and whose `cause` is empty). Only the error
            // PART holds the status-bearing root, so it must be read inline —
            // and reading parts also removes the promise-vs-stream race that a
            // separate onError capture would suffer.
            let text = "";
            const toolCalls: { id: string; name: string; args: unknown }[] = [];
            let usage = { inputTokens: 0, outputTokens: 0 };

            for await (const part of result.fullStream) {
                switch (part.type) {
                    case "text-delta":
                        // Live deltas: forward each partial chunk to the strategy
                        // (which yields text-delta events to the engine/bridge)
                        // as it arrives, instead of buffering the whole turn and
                        // emitting one batch then. This is the actual token
                        // stream the CLI renders.
                        if (!part.text) break;
                        text += part.text;
                        input.onTextDelta?.(part.text);
                        break;
                    case "tool-call":
                        toolCalls.push({ id: part.toolCallId, name: part.toolName, args: part.input ?? {} });
                        break;
                    case "error":
                        streamError = part.error;
                        break;
                    case "finish":
                        usage = {
                            inputTokens: part.totalUsage?.inputTokens ?? 0,
                            outputTokens: part.totalUsage?.outputTokens ?? 0,
                        };
                        break;
                    default:
                        break;
                }
            }

            // A provider failure delivered as an error part does not throw out
            // of the iterator — rethrow it typed so the strategy/engine sees a
            // real failure instead of a silent empty turn.
            if (streamError !== undefined) {
                const envelope = envelopeFromModelError(streamError);
                if (envelope) throw envelope;
                throw streamError instanceof Error ? streamError : new Error(String(streamError));
            }

            return { text, toolCalls, usage };
        } catch (err) {
            // Classify the surfaced error; if the SDK gave us a generic wrapper
            // instead of the root provider error, classify the root captured
            // from the stream's error part.
            const envelope = envelopeFromModelError(err) ?? envelopeFromModelError(streamError);
            if (envelope) throw envelope;
            throw err;
        }
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