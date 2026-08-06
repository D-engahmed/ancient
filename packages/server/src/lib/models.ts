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

// ---- Built-in provider resolvers ----
function resolveOpenAIModel(modelId: string): ResolvedModel {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    return {
        model: createOpenAI({ apiKey })(modelId) as unknown as LanguageModel,
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
        // Built-in Google still uses OpenAI-compatible endpoint for simplicity.
        model: createOpenAI({
            baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
            apiKey,
        })(modelId) as unknown as LanguageModel,
        provider: "google",
        modelId,
    };
}

function resolveDeepSeekModel(modelId: string): ResolvedModel {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
    return {
        model: createOpenAI({ baseURL: "https://api.deepseek.com/v1", apiKey })(modelId) as unknown as LanguageModel,
        provider: "deepseek",
        modelId,
    };
}

function resolveMistralModel(modelId: string): ResolvedModel {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error("MISTRAL_API_KEY is not set");
    return {
        model: createOpenAI({ baseURL: "https://api.mistral.ai/v1", apiKey })(modelId) as unknown as LanguageModel,
        provider: "mistral",
        modelId,
    };
}

function resolveGroqModel(modelId: string): ResolvedModel {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set");
    return {
        model: createOpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey })(modelId) as unknown as LanguageModel,
        provider: "groq",
        modelId,
    };
}

function resolveTogetherModel(modelId: string): ResolvedModel {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) throw new Error("TOGETHER_API_KEY is not set");
    return {
        model: createOpenAI({ baseURL: "https://api.together.xyz/v1", apiKey })(modelId) as unknown as LanguageModel,
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

    let provider: any;

    if (conn.protocol === "anthropic") {
        provider = createAnthropic({ baseURL: conn.baseUrl, apiKey: resolvedApiKey });
    } else {
        // openai, gemini (.../v1beta/openai), deepseek, mistral, groq, together, ollama, lmstudio, vllm, custom
        provider = createOpenAI({ baseURL: conn.baseUrl, apiKey: resolvedApiKey });
    }
    return {
        model: provider(conn.modelId) as unknown as LanguageModel,
        provider: conn.protocol as SupportedProvider | "custom",
        modelId: conn.modelId,
        apiKey: apiKey || undefined,
    };
}