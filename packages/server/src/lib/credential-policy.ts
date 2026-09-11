// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Credential policy (ASSUMPTION-022 — one deployment per company:
// user BYOK first, platform default next, free/local last).
//
// Two levers:
//   1. platformDefaultSelection() — the model a company runs as its platform
//      default, overridable via ANCIENT_DEFAULT_MODEL_ID (instead of the
//      hardcoded DEFAULT_CHAT_MODEL_ID).
//   2. preferUserByok() — when a user selected a BUILTIN model, prefer their
//      own BYOK connection for the SAME provider brand (their key, their
//      quota, cheaper for the company). Only exact-brand matches swap; a
//      builtin openai model never silently routes to a deepseek/mistral/etc.
//      connection.

import {
    findSupportedChatModel,
    DEFAULT_CHAT_MODEL_ID,
    type ChatModelSelection,
    type SupportedChatModelId,
} from "@ANCIENT/shared";

export const PLATFORM_DEFAULT_MODEL_ID_ENV = "ANCIENT_DEFAULT_MODEL_ID";

/** Builtin provider id → the BYOK connection protocol that serves that brand. */
export const BUILTIN_PROVIDER_TO_CONN_PROTOCOL: Record<string, string> = {
    openai: "openai",
    anthropic: "anthropic",
    google: "gemini",
};

/** A minimal view of a user's BYOK connections, enough to govern precedence. */
export type UserByokConnection = {
    id: string;
    protocol: string;
    modelId: string;
    baseUrl: string;
    isValid: boolean;
};

/** Resolves the platform default selection, honoring a company override. */
export function platformDefaultSelection(
    overrideModelId?: string,
): ChatModelSelection {
    const modelId =
        overrideModelId
        ?? process.env[PLATFORM_DEFAULT_MODEL_ID_ENV]
        ?? DEFAULT_CHAT_MODEL_ID;
    const known = findSupportedChatModel(modelId);
    if (!known) {
        // Never silently pick an unknown model — fall back to the builtin
        // default so the platform still boots; the operator's env var is
        // loud and obvious in server logs/consumer errors.
        return { modelKind: "builtin", modelId: DEFAULT_CHAT_MODEL_ID };
    }
    return { modelKind: "builtin", modelId: modelId as SupportedChatModelId };
}

/**
 * Precedence: user BYOK before platform default, but ONLY for the same
 * provider brand. Returns a custom (BYOK) selection when the user selected a
 * builtin model and holds a valid connection for that exact brand; otherwise
 * leaves the selection untouched (platform default stays).
 */
export function preferUserByok(
    selection: ChatModelSelection,
    connections: readonly UserByokConnection[],
): ChatModelSelection {
    if (selection.modelKind !== "builtin") return selection;
    const model = findSupportedChatModel(selection.modelId);
    if (!model) return selection;

    const wantedConnProtocol = BUILTIN_PROVIDER_TO_CONN_PROTOCOL[model.provider];
    if (!wantedConnProtocol) return selection;

    const match = connections.find(
        (c) => c.isValid && c.protocol === wantedConnProtocol,
    );
    if (!match) return selection;

    return { modelKind: "custom", connectionId: match.id };
}