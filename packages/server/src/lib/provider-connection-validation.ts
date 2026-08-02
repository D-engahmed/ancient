type ConnectionProtocol = "openai" | "anthropic" | "gemini";

type ConnectionInput = {
    protocol: ConnectionProtocol;
    baseUrl: string;
    apiKey: string;
};

export class ProviderConnectionValidationError extends Error {}

function modelsUrl(protocol: ConnectionProtocol, baseUrl: string): URL {
    const path = protocol === "anthropic" ? "v1/models" : "models";
    return new URL(path, `${baseUrl.replace(/\/+$/, "")}/`);
}

export async function validateProviderConnection(input: ConnectionInput): Promise<void> {
    const headers = new Headers({ Accept: "application/json" });
    const url = modelsUrl(input.protocol, input.baseUrl);

    if (input.protocol === "gemini") {
        headers.set("x-goog-api-key", input.apiKey);
    } else if (input.apiKey) {
        headers.set("Authorization", `Bearer ${input.apiKey}`);
    }

    let response: Response;
    try {
        response = await fetch(url, {
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
