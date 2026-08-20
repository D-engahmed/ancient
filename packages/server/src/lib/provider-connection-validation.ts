// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

type ConnectionProtocol = "openai" | "anthropic" | "gemini";

type ConnectionInput = {
    protocol: ConnectionProtocol;
    baseUrl: string;
    apiKey: string;
    modelId?: string;
};

export class ProviderConnectionValidationError extends Error { }

// Anthropic's Messages/Models API authenticates with `x-api-key` (+ a
// required `anthropic-version` header) — never `Authorization: Bearer`.
// Sending a real sk-ant-... key as a bearer token gets rejected as an
// "Invalid bearer token" by Anthropic's API, not treated as a bad key.
const ANTHROPIC_VERSION = "2023-06-01";

function modelsUrl(protocol: ConnectionProtocol, baseUrl: string): URL {
    const path = protocol === "anthropic" ? "v1/models" : "models";
    return new URL(path, `${baseUrl.replace(/\/+$/, "")}/`);
}

// The models list endpoint doesn't have one universal shape, but every
// provider we support (OpenAI-compatible `{ data: [{ id }] }` and
// Anthropic's `{ data: [{ id }] }`) exposes the id under one of these
// keys on each list entry. Extract defensively instead of assuming a
// single schema.
function extractModelIds(body: unknown): string[] {
    if (!body || typeof body !== "object") return [];
    const list = Array.isArray((body as { data?: unknown }).data)
        ? (body as { data: unknown[] }).data
        : Array.isArray(body)
            ? (body as unknown[])
            : [];
    return list
        .map((entry) => {
            if (!entry || typeof entry !== "object") return undefined;
            const id = (entry as { id?: unknown }).id ?? (entry as { name?: unknown }).name;
            return typeof id === "string" ? id : undefined;
        })
        .filter((id): id is string => !!id);
}

// Google's /openai/models shim still reports ids in its native resource-name
// form ("models/gemini-2.5-flash") even though every other Gemini surface in
// this app — the actual chat request in lib/models.ts, the shared provider
// catalog, and whatever the user typed — uses the bare id ("gemini-2.5-flash").
// Left unstripped, that mismatch meant a *correct* Gemini modelId still failed
// this cross-check every time, because "gemini-2.5-flash" !== "models/gemini-2.5-flash".
// Stripping the prefix is a no-op for OpenAI/Anthropic, which never emit it.
function stripModelsPrefix(id: string): string {
    return id.startsWith("models/") ? id.slice("models/".length) : id;
}

export async function validateProviderConnection(input: ConnectionInput): Promise<void> {
    const headers = new Headers({ Accept: "application/json" });
    let url: URL;

    if (input.protocol === "anthropic") {
        url = modelsUrl(input.protocol, input.baseUrl);
        if (input.apiKey) {
            headers.set("x-api-key", input.apiKey);
            headers.set("anthropic-version", ANTHROPIC_VERSION);
        }
    } else {
        // openai AND gemini (Google's OpenAI-compatible surface) — both Bearer.
        url = modelsUrl(input.protocol, input.baseUrl);
        if (input.apiKey) {
            headers.set("Authorization", `Bearer ${input.apiKey}`);
        }
    }

    let response: Response;
    try {
        response = await fetch(url.toString(), {
            headers,
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        throw new ProviderConnectionValidationError("Could not reach the provider. Check the base URL and network connection.");
    }

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new ProviderConnectionValidationError("The API key is invalid or does not have permission for this provider.");
        }
        throw new ProviderConnectionValidationError(
            `The provider rejected validation with HTTP ${response.status}. Check the base URL and model provider.`,
        );
    }

    // Reachability + auth passing isn't enough — a connection with a
    // mistyped or wrong-cased modelId used to save as isValid: true and
    // only fail later, mid-chat, with an opaque wrapped provider error.
    // Cross-check the modelId against the provider's own model list here,
    // while we still have a clear place to report it.
    if (input.modelId) {
        let body: unknown;
        try {
            body = await response.json();
        } catch {
            // Some providers don't return a parseable model list body even
            // on a 200 (e.g. minimal local servers) — don't fail validation
            // over that; there's nothing to cross-check against.
            return;
        }
        const rawAvailableIds = extractModelIds(body);
        if (rawAvailableIds.length === 0) return;

        // Compare (and suggest) using the normalized form, but keep the
        // original strings around so any error message still shows models
        // the way this provider's list actually spells them.
        const availableIds = rawAvailableIds.map(stripModelsPrefix);
        const wantedId = stripModelsPrefix(input.modelId);
        if (availableIds.includes(wantedId)) return;

        const caseInsensitiveIndex = availableIds.findIndex(
            (id) => id.toLowerCase() === wantedId.toLowerCase(),
        );
        if (caseInsensitiveIndex !== -1) {
            throw new ProviderConnectionValidationError(
                `Model "${input.modelId}" was not found — did you mean "${rawAvailableIds[caseInsensitiveIndex]}"? Model IDs are case-sensitive.`,
            );
        }

        const suggestions = rawAvailableIds.slice(0, 5).join(", ");
        throw new ProviderConnectionValidationError(
            `Model "${input.modelId}" was not found in this provider's model list. Available models include: ${suggestions}${rawAvailableIds.length > 5 ? ", …" : ""}.`,
        );
    }
}
