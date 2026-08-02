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

// ---------- Built‑in resolvers ----------

function resolveAnthropicModel(modelId: string): ResolvedModel {
    const { anthropic } = require("@ai-sdk/anthropic");
    return {
        model: anthropic(modelId),
        provider: "anthropic",
        modelId,
    };
}

function resolveOpenAIModel(modelId: string): ResolvedModel {
    const { openai } = require("@ai-sdk/openai");
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

// ---------- Model catalog validation (DB-backed) ----------

// In‑memory cache: providerId -> Set of model IDs (lowercase)
let catalogCache: Map<string, Set<string>> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

async function refreshCatalogCache() {
    const providers = await db.modelProvider.findMany({
        include: { models: { where: { isActive: true } } },
    });
    const newCache = new Map<string, Set<string>>();
    for (const p of providers) {
        const modelIds = new Set(p.models.map(m => m.modelId.toLowerCase()));
        newCache.set(p.id.toLowerCase(), modelIds);
    }
    catalogCache = newCache;
    cacheTimestamp = Date.now();
}

async function getCatalogCache(): Promise<Map<string, Set<string>>> {
    if (!catalogCache || Date.now() - cacheTimestamp > CACHE_TTL_MS) {
        await refreshCatalogCache();
    }
    return catalogCache!;
}

export async function validateModelId(
    protocol: string,
    modelId: string,
    userId?: string // optionally for future user‑specific overrides
): Promise<boolean> {
    const cache = await getCatalogCache();
    const providerKey = protocol.toLowerCase();
    const models = cache.get(providerKey);
    if (!models) return false;
    return models.has(modelId.toLowerCase());
}

// ---------- Main resolver for both built‑in and custom ----------

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

    // Optional: validate that the model ID is in the catalog (if the provider is known)
    // We'll log a warning if not, but not block – some providers may have custom models.
    const known = await validateModelId(conn.protocol, conn.modelId);
    if (!known) {
        console.warn(`[models] Unknown model ID for protocol ${conn.protocol}: ${conn.modelId}`);
        // You could decide to throw here if you want strict validation:
        // throw new Error(`Model "${conn.modelId}" is not recognized for provider "${conn.protocol}".`);
    }

    await assertSafeBaseUrl(conn.baseUrl);
    const apiKey = await decryptApiKey(conn.encryptedKey);
    const resolvedApiKey = apiKey || "not-needed";

    await db.providerConnection.update({
        where: { id: conn.id },
        data: { lastUsedAt: new Date() },
    });

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

// ---------- Legacy "aun" provider (env‑based) ----------
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

// Keep existing resolveAunModel if you have it – not shown here for brevity.