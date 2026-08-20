// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { db } from "@ANCIENT/database/client";
import { decryptApiKey } from "./connection-crypto";
import { assertSafeBaseUrl } from "./safe-url";
import type { ChatModelSelection, SupportedChatModel, SupportedProvider } from "@ANCIENT/shared";
import { findSupportedChatModel } from "@ANCIENT/shared";

export type ResolvedModel = {
    model: LanguageModel;
    provider: SupportedProvider | "custom";
    modelId: string;
    apiKey?: string;
};

// ---- OpenRouter model-fallback fetch wrapper (opt-in) ----
// Some `:free` models (e.g. z-ai/glm-5.2:free) are currently served by a
// single upstream provider (Decart). When that provider rate-limits, there
// is no *other* provider to route around — excluding it via `provider.ignore`
// just leaves zero eligible providers and turns a retryable 429 into a hard
// 404 ("All providers have been ignored"). Learned that the hard way; do not
// reintroduce provider.ignore for this reason.
//
// The safe lever is OpenRouter's model-level fallback: pass a `models` array
// and OpenRouter tries the next *model* (which may live on a different
// provider entirely) if the primary one fails.
// https://openrouter.ai/docs/features/model-routing
//
// Off by default — only activates when ANCIENT_OPENROUTER_FALLBACK_MODELS is
// set, so connections that don't opt in see no behavior change.
function parseFallbackModels(): string[] {
    const raw = process.env.ANCIENT_OPENROUTER_FALLBACK_MODELS;
    if (!raw) return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function openRouterModelFallbackFetch(primaryModelId: string, fallbackModels: string[]): typeof fetch {
    return async (input, init) => {
        if (init?.body && typeof init.body === "string") {
            try {
                const body = JSON.parse(init.body);
                if (body.model === primaryModelId) {
                    body.models = [primaryModelId, ...fallbackModels];
                }
                init = { ...init, body: JSON.stringify(body) };
            } catch {
                // Body wasn't JSON (or wasn't a chat-completions call) — pass through unchanged.
            }
        }
        return fetch(input, init);
    };
}

function isOpenRouterBaseUrl(baseUrl: string): boolean {
    try {
        return new URL(baseUrl).hostname === "openrouter.ai";
    } catch {
        return false;
    }
}

function maybeOpenRouterFetch(baseUrl: string, modelId: string): { fetch: typeof fetch } | Record<string, never> {
    if (!isOpenRouterBaseUrl(baseUrl)) return {};
    const fallbacks = parseFallbackModels();
    if (fallbacks.length === 0) return {};
    return { fetch: openRouterModelFallbackFetch(modelId, fallbacks) };
}

// ---- Built-in provider resolvers ----
function resolveOpenAIModel(modelId: string): ResolvedModel {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    return {
        model: createOpenAI({ apiKey }).chat(modelId) as unknown as LanguageModel,
        provider: "openai",
        modelId,
    };
}

function resolveAnthropicModel(modelId: string): ResolvedModel {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    return {
        model: createAnthropic({ apiKey })(modelId),
        provider: "anthropic",
        modelId,
    };
}

function resolveGoogleModel(modelId: string): ResolvedModel {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");
    return {
        // Native Google provider, not the OpenAI-compat shim: Gemini's
        // OpenAI-compatible streaming format omits `index` on tool-call
        // deltas, which fails the ai SDK's strict OpenAI chunk schema
        // (AI_TypeValidationError / invalid_union). The native provider
        // speaks Gemini's actual wire format, so this class of mismatch
        // doesn't apply.
        model: createGoogleGenerativeAI({ apiKey })(modelId) as unknown as LanguageModel,
        provider: "google",
        modelId,
    };
}

function resolveDeepSeekModel(modelId: string): ResolvedModel {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
    return {
        model: createOpenAI({ baseURL: "https://api.deepseek.com/v1", apiKey }).chat(modelId) as unknown as LanguageModel,
        provider: "deepseek",
        modelId,
    };
}

function resolveMistralModel(modelId: string): ResolvedModel {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error("MISTRAL_API_KEY is not set");
    return {
        model: createOpenAI({ baseURL: "https://api.mistral.ai/v1", apiKey }).chat(modelId) as unknown as LanguageModel,
        provider: "mistral",
        modelId,
    };
}

function resolveGroqModel(modelId: string): ResolvedModel {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set");
    return {
        model: createOpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey }).chat(modelId) as unknown as LanguageModel,
        provider: "groq",
        modelId,
    };
}

function resolveTogetherModel(modelId: string): ResolvedModel {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) throw new Error("TOGETHER_API_KEY is not set");
    return {
        model: createOpenAI({ baseURL: "https://api.together.xyz/v1", apiKey }).chat(modelId) as unknown as LanguageModel,
        provider: "together",
        modelId,
    };
}

function resolveSupportedChatModel(model: SupportedChatModel): ResolvedModel {
    switch (model.provider) {
        case "openai": return resolveOpenAIModel(model.id);
        case "anthropic": return resolveAnthropicModel(model.id);
        case "google": return resolveGoogleModel(model.id);
        case "deepseek": return resolveDeepSeekModel(model.id);
        case "mistral": return resolveMistralModel(model.id);
        case "groq": return resolveGroqModel(model.id);
        case "together": return resolveTogetherModel(model.id);
        case "ollama":
        case "lmstudio":
        case "vllm":
        case "custom":
            throw new Error(`${model.provider} models require a BYOK connection. Add one via the model picker.`);
        default:
            throw new Error("Unsupported provider");
    }
}

// ---- Free/local model resolver ----
// Used by the model router (free-first lane) and by subagents with
// `model: cheap`. Resolution order:
//   1. modelRouting.freeModel in .ancient/settings.json (passed in as cfg)
//   2. ANCIENT_FREE_MODEL_* env vars
//   3. null — caller falls back to the user's selected model
export type FreeModelConfig = {
    baseUrl: string;
    modelId: string;
    apiKeyEnv?: string;
};

export function resolveFreeModel(cfg?: FreeModelConfig): ResolvedModel | null {
    const baseUrl = cfg?.baseUrl || process.env.ANCIENT_FREE_MODEL_BASE_URL;
    const modelId = cfg?.modelId || process.env.ANCIENT_FREE_MODEL_ID;
    if (!baseUrl || !modelId) return null;

    const keyEnv = cfg?.apiKeyEnv ?? "ANCIENT_FREE_MODEL_API_KEY";
    const apiKey = process.env[keyEnv]; // local servers (Ollama etc.) need none

    return {
        model: createOpenAI({
            baseURL: baseUrl,
            apiKey,
            ...maybeOpenRouterFetch(baseUrl, modelId),
        }).chat(modelId) as unknown as LanguageModel,
        provider: "custom",
        modelId,
        apiKey: apiKey || undefined,
    };
}

// ---- BYOK connection resolver ----
export async function resolveChatModel(
    selection: ChatModelSelection,
    userId: string
): Promise<ResolvedModel> {
    if (selection.modelKind === "builtin") {
        const model = findSupportedChatModel(selection.modelId);
        if (!model) throw new Error(`Unsupported built‑in model: ${selection.modelId}`);
        return resolveSupportedChatModel(model);
    }

    const conn = await db.providerConnection.findUnique({
        where: { id: selection.connectionId, userId },
    });
    if (!conn) throw new Error("Connection not found");
    if (!conn.isValid) {
        throw new Error("This provider connection is invalid. Revalidate or rotate its API key before using it.");
    }

    await assertSafeBaseUrl(conn.baseUrl);
    const apiKey = await decryptApiKey(conn.encryptedKey);
    const resolvedApiKey = apiKey || undefined;

    await db.providerConnection.update({
        where: { id: conn.id },
        data: { lastUsedAt: new Date() },
    });

    let model: LanguageModel;

    if (conn.protocol === "anthropic") {
        model = createAnthropic({ baseURL: conn.baseUrl, apiKey: resolvedApiKey })(conn.modelId) as unknown as LanguageModel;
    } else if (conn.protocol === "gemini") {
        // Native provider, not the OpenAI-compat shim — see the comment
        // in resolveGoogleModel above for why. Deliberately NOT passing
        // conn.baseUrl through: it was captured for the OpenAI-compat
        // endpoint shape (".../v1beta/openai") and doesn't apply to the
        // native API's request paths. Google's generative-language API
        // has one standard endpoint; if you need custom-baseURL support
        // for Gemini specifically (e.g. a proxy), that needs its own
        // explicit handling here, not a silent pass-through.
        model = createGoogleGenerativeAI({ apiKey: resolvedApiKey })(conn.modelId) as unknown as LanguageModel;
    } else {
        // openai, deepseek, mistral, groq, together, ollama, lmstudio, vllm, custom
        //
        // If ANCIENT_OPENROUTER_FALLBACK_MODELS is set and this connection
        // points at OpenRouter, failed requests fall back to those models
        // instead of retrying the same (possibly rate-limited) provider.
        // No-op when the env var is unset.
        model = createOpenAI({
            baseURL: conn.baseUrl,
            apiKey: resolvedApiKey,
            ...maybeOpenRouterFetch(conn.baseUrl, conn.modelId),
        }).chat(conn.modelId) as unknown as LanguageModel;
    }
    return {
        model,
        provider: conn.protocol as SupportedProvider | "custom",
        modelId: conn.modelId,
        apiKey: apiKey || undefined,
    };
}