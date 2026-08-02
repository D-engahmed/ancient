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

// FIXED: ESM imports instead of require()
function resolveAnthropicModel(modelId: string): ResolvedModel {
    return {
        model: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelId),
        provider: "anthropic",
        modelId,
    };
}

function resolveOpenAIModel(modelId: string): ResolvedModel {
    return {
        model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(modelId),
        provider: "openai",
        modelId,
    };
}

function resolveSupportedChatModel(model: SupportedChatModel): ResolvedModel {
    if (model.provider === "anthropic") return resolveAnthropicModel(model.id);
    if (model.provider === "openai") return resolveOpenAIModel(model.id);
    throw new Error(`Unsupported provider: ${String(model.provider)}`);
}

// ---------- Catalog cache ----------
let catalogCache: Map<string, Set<string>> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

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

export async function validateModelId(protocol: string, modelId: string): Promise<boolean> {
    const cache = await getCatalogCache();
    const providerKey = protocol.toLowerCase();
    const models = cache.get(providerKey);
    if (!models) return false;
    return models.has(modelId.toLowerCase());
}

export async function invalidateCatalogCache() {
    catalogCache = null;
    cacheTimestamp = 0;
}

// ---------- Main resolver ----------
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

    const known = await validateModelId(conn.protocol, conn.modelId);
    if (!known) {
        console.warn(`[models] Unknown model ID for protocol ${conn.protocol}: ${conn.modelId}`);
    }

    await assertSafeBaseUrl(conn.baseUrl);
    const apiKey = await decryptApiKey(conn.encryptedKey);
    // FIXED: undefined instead of "not-needed"
    const resolvedApiKey = apiKey || undefined;

    await db.providerConnection.update({
        where: { id: conn.id },
        data: { lastUsedAt: new Date() },
    });

    let provider;
    switch (conn.protocol) {
        case "openai":
            provider = createOpenAI({ baseURL: conn.baseUrl, apiKey: resolvedApiKey });
            break;
        case "anthropic":
            provider = createAnthropic({ baseURL: conn.baseUrl, apiKey: resolvedApiKey });
            break;
        case "gemini":
            provider = createGoogleGenerativeAI({ baseURL: conn.baseUrl, apiKey: resolvedApiKey });
            break;
        default:
            throw new Error(`Unknown protocol: ${conn.protocol}`);
    }

    return {
        model: provider(conn.modelId) as unknown as LanguageModel,
        provider: "custom",
        modelId: conn.modelId,
        apiKey,
    };
}