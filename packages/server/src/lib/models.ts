// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { makeError } from "@ANCIENT/contracts";
import { db } from "@ANCIENT/database/client";
import { decryptApiKey } from "./connection-crypto";
import { assertSafeBaseUrl } from "./safe-url";
import { defaultProviderRegistry, type ResolvedModel } from "./provider-registry";
import type { ChatModelSelection, SupportedChatModel } from "@ANCIENT/shared";
import { findSupportedChatModel, DEFAULT_CHAT_MODEL_ID } from "@ANCIENT/shared";

export type { ResolvedModel } from "./provider-registry";

// ---- Built-in provider resolution ----
// All builtin env-key resolvers (openai/deepseek/mistral/groq/together,
// anthropic, google) now live behind the provider registry
// (provider-registry.ts, ASSUMPTION-021): a provider is a plugin, not a
// switch branch. The functions below are thin provenance adapters.

function resolveSupportedChatModel(model: SupportedChatModel): ResolvedModel {
    return defaultProviderRegistry.resolve({
        provenance: "env",
        protocol: model.provider,
        modelId: model.id,
    });
}

// ---- Fallback helper (after a rate limit) ----
// Cheap, dependency-free fallback target: the builtin default model. Never
// throws — returns null when the builtin can't be resolved (e.g. its backing
// env var is unset), so the caller can move on to the next candidate.
export function resolveBuiltinFallbackModel(): ResolvedModel | null {
    const model = findSupportedChatModel(DEFAULT_CHAT_MODEL_ID);
    if (!model) return null;
    try {
        return resolveSupportedChatModel(model);
    } catch {
        return null;
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
    const apiKey = process.env[keyEnv];

    return defaultProviderRegistry.resolve({
        provenance: "connection",
        protocol: "custom",
        baseUrl,
        apiKey,
        modelId,
    });
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
    if (!conn) {
        throw makeError({
            code: "PROVIDER_UNAVAILABLE",
            domain: "gateway",
            message: "Connection not found",
            clientMessage: "Connection not found. Re-add it via the model picker.",
            transient: false,
        });
    }
    if (!conn.isValid) {
        throw makeError({
            code: "PROVIDER_AUTH_FAILED",
            domain: "provider",
            message: "This provider connection is invalid",
            clientMessage: "This provider connection is invalid. Revalidate or rotate its API key before using it.",
            transient: false,
        });
    }

    await assertSafeBaseUrl(conn.baseUrl);
    const apiKey = await decryptApiKey(conn.encryptedKey);

    await db.providerConnection.update({
        where: { id: conn.id },
        data: { lastUsedAt: new Date() },
    });

    // anthropic / gemini / openai(+local) all resolve via registered plugins.
    return defaultProviderRegistry.resolve({
        provenance: "connection",
        protocol: conn.protocol,
        baseUrl: conn.baseUrl,
        apiKey,
        modelId: conn.modelId,
    });
}