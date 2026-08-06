// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

type ConnectionProtocol = "openai" | "anthropic" | "gemini";

type ConnectionInput = {
    protocol: ConnectionProtocol;
    baseUrl: string;
    apiKey: string;
    Model?: string;
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

    if (response.ok) return;

    if (response.status === 401 || response.status === 403) {
        throw new ProviderConnectionValidationError("The API key is invalid or does not have permission for this provider.");
    }

    throw new ProviderConnectionValidationError(
        `The provider rejected validation with HTTP ${response.status}. Check the base URL and model provider.`,
    );
}