/**
 * Backend Router
 *
 * Actually calls a model. runtime/engine.ts and runtime/executor.ts both
 * imported BackendRouter from "../backends/router" — the module, and every
 * model call this whole package claims to make, did not exist.
 *
 * Scope note: tool execution (AgentDefinition.tools) is accepted in the
 * options shape but not wired to real tool implementations here. Those
 * live in packages/server/src/tools/* and are bound to a server request
 * context (cwd, auth). Giving this package its own duplicate tool
 * implementations would drift from the real ones; giving agents fake tool
 * access without executing anything would make them hallucinate results.
 * Wiring real tool calls needs a shared tool-execution interface — a
 * decision for you to make, not something to fake here.
 */

import { generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { BackendConfig, ModelRoutingConfig } from "../types";

export interface BackendExecutionOptions {
    expectJson?: boolean;
    jsonSchema?: Record<string, unknown>;
    timeoutMs?: number;
    tools?: string[];
    abortSignal?: AbortSignal;
}

export interface BackendExecutionResult {
    text: string;
    usage?: { promptTokens: number; completionTokens: number };
    cost?: number;
    toolCalls?: number;
}

// Rough per-million-token pricing used only for relative cost tracking
// between agents in a run. Real prices change without notice and
// @ANCIENT/shared/src/models.ts already has a ModelPricing type per catalog
// entry — wire cost tracking to that catalog before this number is used
// for anything resembling a bill.
const FALLBACK_COST_PER_MILLION = { input: 3, output: 15 };

function resolveModel(backend: BackendConfig): LanguageModel {
    switch (backend.provider) {
        case "anthropic":
            return createAnthropic({ apiKey: backend.apiKey, baseURL: backend.baseUrl })(backend.model);
        case "openai":
            return createOpenAI({ apiKey: backend.apiKey, baseURL: backend.baseUrl })(backend.model);
        case "google":
            return createGoogleGenerativeAI({ apiKey: backend.apiKey, baseURL: backend.baseUrl })(backend.model);
        default:
            // deepseek, mistral, groq, together, ollama, lmstudio, vllm,
            // openrouter, custom — all speak an OpenAI-compatible API, but
            // each has a different base URL and I'm not hardcoding endpoints
            // here that I can't verify are current. Caller must set baseUrl.
            if (!backend.baseUrl) {
                throw new Error(
                    `Provider "${backend.provider}" has no first-party SDK here and needs an explicit ` +
                        `baseUrl (OpenAI-compatible endpoint) on its BackendConfig.`
                );
            }
            return createOpenAI({ apiKey: backend.apiKey, baseURL: backend.baseUrl })(backend.model);
    }
}

export class BackendRouter {
    /**
     * Tries the primary backend, then each fallback in order, on failure.
     *
     * routing.routingRules is part of the ModelRoutingConfig contract for
     * condition-based backend selection, but nothing in this repo
     * constructs a non-empty routingRules array yet — team/builder.ts
     * always sets it to []. Interpreting conditions with no real caller to
     * exercise them would be exactly the kind of decorative code this
     * package was just full of — wire it up when something actually
     * populates it.
     */
    async execute(
        routing: ModelRoutingConfig,
        prompt: string,
        options: BackendExecutionOptions = {}
    ): Promise<BackendExecutionResult> {
        const candidates = [routing.primary, ...routing.fallbacks];
        let lastError: Error | undefined;

        for (const backend of candidates) {
            try {
                return await this.callOne(backend, prompt, options);
            } catch (error) {
                lastError = error as Error;
                if (options.abortSignal?.aborted) throw lastError;
                // otherwise fall through to the next candidate
            }
        }
        throw lastError ?? new Error(`No backend candidates configured for agent ${routing.agentId}`);
    }

    private async callOne(
        backend: BackendConfig,
        prompt: string,
        options: BackendExecutionOptions
    ): Promise<BackendExecutionResult> {
        const model = resolveModel(backend);
        const finalPrompt = options.expectJson
            ? `${prompt}\n\nRespond with ONLY valid JSON — no prose, no markdown code fences.`
            : prompt;

        const result = await generateText({
            model,
            prompt: finalPrompt,
            temperature: backend.temperature,
            maxOutputTokens: backend.maxTokens,
            abortSignal: options.abortSignal,
        });

        let text = result.text;
        if (options.expectJson) {
            text = stripJsonFence(text);
            // Fail fast on malformed JSON so AgentExecutor's retry loop
            // actually retries against a fresh generation, rather than
            // handing the caller text that JSON.parse blows up on two
            // layers away (see tasks/decomposer.ts).
            JSON.parse(text);
        }

        const usage = result.usage;
        return {
            text,
            usage: usage ? { promptTokens: usage.inputTokens ?? 0, completionTokens: usage.outputTokens ?? 0 } : undefined,
            cost: usage ? estimateCost(usage.inputTokens ?? 0, usage.outputTokens ?? 0) : undefined,
            toolCalls: 0, // see file header — tool execution isn't wired yet
        };
    }
}

function stripJsonFence(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return (fenced?.[1] ?? text).trim();
}

function estimateCost(inputTokens: number, outputTokens: number): number {
    return (
        (inputTokens / 1_000_000) * FALLBACK_COST_PER_MILLION.input +
        (outputTokens / 1_000_000) * FALLBACK_COST_PER_MILLION.output
    );
}
