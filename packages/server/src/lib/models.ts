// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// file: packages/server/src/lib/models.ts

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
    apiKey?: string; // only present for custom connections, used for redaction
};

// ---------- Built‑in resolvers (only anthropic & openai) ----------

function resolveAnthropicModel(modelId: string): ResolvedModel {
    const anthropic = require("@ai-sdk/anthropic").anthropic; // dynamic import to avoid type issues
    return {
        model: anthropic(modelId),
        provider: "anthropic",
        modelId,
    };
}

function resolveOpenAIModel(modelId: string): ResolvedModel {
    const openai = require("@ai-sdk/openai").openai;
    return {
        model: openai(modelId),
        provider: "openai",
        modelId,
    };
}

function resolveSupportedChatModel(model: SupportedChatModel): ResolvedModel {
    if (model.provider === "anthropic") {
        return resolveAnthropicModel(model.id);
    }
    if (model.provider === "openai") {
        return resolveOpenAIModel(model.id);
    }
    const provider = (model as { provider: string }).provider;
    throw new Error(`Unsupported provider: ${String(provider)}`);
}

// ---------- "aun" server‑operator fallback (unchanged) ----------
// It is defined below – we keep it as is.

// ---------- Main resolver for both built‑in and custom ----------
export async function resolveChatModel(
    selection: ChatModelSelection,
    userId: string
): Promise<ResolvedModel> {
    if (selection.modelKind === "builtin") {
        const model = findSupportedChatModel(selection.modelId);
        if (!model) throw new Error(`Unsupported model: ${selection.modelId}`);
        return resolveSupportedChatModel(model);
    }

    const conn = await db.providerConnection.findUnique({
        where: { id: selection.connectionId, userId },
    });
    if (!conn) throw new Error("Connection not found");

    await assertSafeBaseUrl(conn.baseUrl);
    const apiKey = await decryptApiKey(conn.encryptedKey);
    const resolvedApiKey = apiKey || "not-needed";

    let provider;
    switch (conn.protocol) {
        case "openai":
            provider = createOpenAI({
                baseURL: conn.baseUrl,
                apiKey: resolvedApiKey,
            });
            break;
        case "anthropic":
            provider = createAnthropic({
                baseURL: conn.baseUrl,
                apiKey: resolvedApiKey,
            });
            break;
        case "gemini":
            provider = createGoogleGenerativeAI({
                baseURL: conn.baseUrl,
                apiKey: resolvedApiKey,
            });
            break;
        default:
            throw new Error(`Unknown protocol: ${conn.protocol}`);
    }

    return {
        model: provider(conn.modelId) as unknown as LanguageModel,
        provider: "custom",
        modelId: conn.modelId,
        apiKey, // for redaction in chat.ts
    };
}

// ---------- Keep the existing "aun" provider (env‑based) ----------
// This is the server‑operator fallback, untouched.
function getCustomProvider() {
    const baseURL = getRequiredEnv("ANCIENT_CUSTOM_BASE_URL");
    const apiKey = process.env.ANCIENT_CUSTOM_API_KEY ?? "not-needed";
    return createOpenAI({ baseURL, apiKey });
}

function getRequiredEnv(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} environment variable is required for the 'aun' custom provider`);
    return value;
}

// ... rest of the file (resolveAunModel, etc.) unchanged.
