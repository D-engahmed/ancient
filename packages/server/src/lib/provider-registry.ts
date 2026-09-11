// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Model provider registry (ASSUMPTION-021).
//
// The migration step toward the Layer 19 canonical `ModelProviderPlugin`
// contract (`packages/contracts/src/model.ts`, canonical CompletionEvents).
// For now a provider is a `ModelResolvingPlugin`: it turns
// (protocol, modelId, baseUrl?, apiKey?, provenance) into a `ResolvedModel`
// whose handle is an AI-SDK `LanguageModel` — the exact port the execution
// engine consumes via `createAiModelChat`. The engine/strategies never see a
// provider; adding a provider = registering a plugin, never editing the
// resolver or the engine.

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { makeError } from "@ANCIENT/contracts";
import type { SupportedProvider } from "@ANCIENT/shared";

export type ResolvedModel = {
    model: LanguageModel;
    provider: SupportedProvider | "custom";
    modelId: string;
    apiKey?: string;
};

/** How the credentials were obtained for this resolution. */
export type Provenance = "env" | "connection";

export type ResolveInput = {
    protocol: string;
    modelId: string;
    /** Provider endpoint. Absent for env-driven builtins with a vendor default. */
    baseUrl?: string;
    /** Explicit (BYOK / free / platform-default) key; absent → plugin falls back to env. */
    apiKey?: string;
    provenance: Provenance;
    /** Opt-in OpenRouter model-level fallback list (see models.ts rationale). */
    openRouterFallbackModels?: string[];
};

/** One provider family: how a LanguageModel gets built for its protocols. */
export interface ModelResolvingPlugin {
    readonly id: string;
    readonly label: string;
    readonly protocols: readonly string[];
    readonly credentialMode: "env" | "byok" | "either";
    /**
     * Builds a LanguageModel synchronously — resolution itself performs no
     * I/O; credential lookup (DB/env) happens at the call sites feeding the
     * input.
     */
    resolve(input: ResolveInput): ResolvedModel;
}

export class ProviderRegistry {
    #plugins = new Map<string, ModelResolvingPlugin>();

    register(plugin: ModelResolvingPlugin): void {
        for (const protocol of plugin.protocols) {
            if (this.#plugins.has(protocol)) {
                throw new Error(`Protocol "${protocol}" is already registered by plugin "${this.#plugins.get(protocol)!.id}"`);
            }
            this.#plugins.set(protocol, plugin);
        }
    }

    supports(protocol: string): boolean {
        return this.#plugins.has(protocol);
    }

    find(pluginId: string): ModelResolvingPlugin | undefined {
        return [...this.#plugins.values()].find((p) => p.id === pluginId);
    }

    list(): ModelResolvingPlugin[] {
        return [...this.#plugins.values()].filter(
            (plugin, index, all) => all.findIndex((p) => p.id === plugin.id) === index,
        );
    }

    resolve(input: ResolveInput): ResolvedModel {
        const plugin = this.#plugins.get(input.protocol);
        if (!plugin) {
            throw makeError({
                code: "PROVIDER_UNAVAILABLE",
                domain: "provider",
                message: `No provider plugin registered for protocol "${input.protocol}"`,
                clientMessage: `No provider plugin is registered for "${input.protocol}". Install the matching provider plugin.`,
                transient: false,
            });
        }
        return plugin.resolve(input);
    }
}

// ---------------------------------------------------------------------------
// Built-in env-key adapter family (OpenAI-compatible wire format).
// Expressed as data so provider #6 is a one-line table entry, not a copy-paste
// function (mirrors the former OPENAI_COMPATIBLE_PROVIDERS table in models.ts).
// ---------------------------------------------------------------------------

const OPENAI_COMPATIBLE_PROVIDERS = {
    openai: { envVar: "OPENAI_API_KEY" },
    deepseek: { envVar: "DEEPSEEK_API_KEY", baseURL: "https://api.deepseek.com/v1" },
    mistral: { envVar: "MISTRAL_API_KEY", baseURL: "https://api.mistral.ai/v1" },
    groq: { envVar: "GROQ_API_KEY", baseURL: "https://api.groq.com/openai/v1" },
    together: { envVar: "TOGETHER_API_KEY", baseURL: "https://api.together.xyz/v1" },
} as const satisfies Record<string, { envVar: string; baseURL?: string }>;

const LOCAL_PROTOCOLS: readonly string[] = ["ollama", "lmstudio", "vllm", "custom"];

export type OpenAICompatibleProvider = keyof typeof OPENAI_COMPATIBLE_PROVIDERS | (typeof LOCAL_PROTOCOLS)[number];

// ---- OpenRouter model-fallback fetch wrapper (opt-in) ----
// Some `:free` models (e.g. z-ai/glm-5.2:free) are currently served by a
// single upstream provider (Decart). When that provider rate-limits, there
// is no *other* provider to route around — excluding it via `provider.ignore`
// just leaves zero eligible providers and turns a retryable 429 into a hard
// 404 ("All providers have been ignored"). The safe lever is OpenRouter's
// model-level fallback: pass a `models` array and OpenRouter tries the next
// *model* (which may live on a different provider) if the primary one fails.
// Off by default — only activates when ANCIENT_OPENROUTER_FALLBACK_MODELS is
// set, so connections that don't opt in see no behavior change.

function parseFallbackModels(): string[] {
    const raw = process.env.ANCIENT_OPENROUTER_FALLBACK_MODELS;
    if (!raw) return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function openRouterModelFallbackFetch(primaryModelId: string, fallbackModels: string[]): typeof fetch {
    return (async (input, init) => {
        if (init?.body && typeof init.body === "string") {
            try {
                const body = JSON.parse(init.body);
                if (body.model === primaryModelId) {
                    body.models = [primaryModelId, ...fallbackModels];
                }
                init = { ...init, body: JSON.stringify(body) };
            } catch {
                // Body wasn't JSON — pass through unchanged.
            }
        }
        return fetch(input, init);
    }) as typeof fetch;
}

function isOpenRouterBaseUrl(baseUrl: string): boolean {
    try {
        return new URL(baseUrl).hostname === "openrouter.ai";
    } catch {
        return false;
    }
}

function openRouterFetchIfEligible(input: ResolveInput): { fetch: typeof fetch } | Record<string, never> {
    if (!input.baseUrl || !isOpenRouterBaseUrl(input.baseUrl)) return {};
    const fallbacks = input.openRouterFallbackModels ?? parseFallbackModels();
    if (fallbacks.length === 0) return {};
    return { fetch: openRouterModelFallbackFetch(input.modelId, fallbacks) };
}

function envKeyOrThrow(envVar: string, protocol: string): string {
    const apiKey = process.env[envVar];
    if (!apiKey) {
        throw makeError({
            code: "PROVIDER_AUTH_FAILED",
            domain: "provider",
            message: `${envVar} is not set`,
            clientMessage: `No API key configured for ${envVar}. Set it in .env and restart the server.`,
            transient: false,
        });
    }
    return apiKey;
}

function localProviderNeedsConnection(protocol: string): never {
    throw makeError({
        code: "PROVIDER_AUTH_FAILED",
        domain: "provider",
        message: `${protocol} models require a BYOK connection`,
        clientMessage: `${protocol} models require a BYOK connection. Add one via the model picker.`,
        transient: false,
    });
}

function resolveOpenAICompatible(input: ResolveInput): ResolvedModel {
    const isLocal = (LOCAL_PROTOCOLS as readonly string[]).includes(input.protocol);

    if (input.provenance === "env") {
        if (isLocal) localProviderNeedsConnection(input.protocol);
        const providerKey = input.protocol as keyof typeof OPENAI_COMPATIBLE_PROVIDERS;
        const entry = OPENAI_COMPATIBLE_PROVIDERS[providerKey];
        // env-key builtins always carry a fixed env var for their key.
        const apiKey = envKeyOrThrow((entry as { envVar: string }).envVar, input.protocol);
        const baseURL: string | undefined = "baseURL" in entry ? entry.baseURL : undefined;
        return {
            model: createOpenAI({ apiKey, baseURL }).chat(input.modelId) as unknown as LanguageModel,
            provider: input.protocol as SupportedProvider,
            modelId: input.modelId,
        };
    }

    // connection path (BYOK / free / platform-default): baseUrl-driven, key optional
    const apiKey = input.apiKey || undefined;
    return {
        model: createOpenAI({
            baseURL: input.baseUrl,
            apiKey,
            ...openRouterFetchIfEligible(input),
        }).chat(input.modelId) as unknown as LanguageModel,
        provider: input.protocol as SupportedProvider | "custom",
        modelId: input.modelId,
        apiKey,
    };
}

/** OpenAI-compatible plugin factory (openai + deepseek/mistral/groq/together, and all local protocols). */
export function createOpenAICompatiblePlugin(): ModelResolvingPlugin {
    return {
        id: "openai-compatible",
        label: "OpenAI-compatible (incl. local servers)",
        protocols: [...Object.keys(OPENAI_COMPATIBLE_PROVIDERS), ...LOCAL_PROTOCOLS] as readonly string[],
        credentialMode: "either",
        resolve: resolveOpenAICompatible,
    };
}

export function createAnthropicPlugin(): ModelResolvingPlugin {
    return {
        id: "anthropic",
        label: "Anthropic Claude",
        protocols: ["anthropic"],
        credentialMode: "either",
        resolve(input): ResolvedModel {
            const apiKey = input.apiKey ?? (input.provenance === "env" ? envKeyOrThrow("ANTHROPIC_API_KEY", "anthropic") : undefined);
            return {
                model: createAnthropic({
                    apiKey: apiKey || undefined,
                    ...(input.baseUrl ? { baseURL: input.baseUrl } : {}),
                })(input.modelId) as unknown as LanguageModel,
                provider: "anthropic",
                modelId: input.modelId,
                apiKey,
            };
        },
    };
}

export function createGooglePlugin(): ModelResolvingPlugin {
    return {
        id: "google",
        label: "Google Gemini",
        // "google" is the builtin catalog's provider id; "gemini" is the
        // protocol a BYOK connection stores (createConnectionSchema enum).
        protocols: ["google", "gemini"],
        credentialMode: "either",
        resolve(input): ResolvedModel {
            const apiKey = input.apiKey ?? (input.provenance === "env" ? envKeyOrThrow("GOOGLE_API_KEY", "google") : undefined);
            // Native Google provider, not the OpenAI-compat shim: Gemini's
            // OpenAI-compatible streaming format omits `index` on tool-call
            // deltas, which fails the ai SDK's strict OpenAI chunk schema
            // (AI_TypeValidationError / invalid_union). The native provider
            // speaks Gemini's actual wire format, so this class of mismatch
            // doesn't apply. Deliberately NOT passing input.baseUrl through:
            // it was captured for the OpenAI-compat endpoint shape
            // (".../v1beta/openai") and doesn't apply to the native API's
            // request paths.
            return {
                model: createGoogleGenerativeAI({ apiKey: apiKey || undefined })(input.modelId) as unknown as LanguageModel,
                provider: "google",
                modelId: input.modelId,
                apiKey,
            };
        },
    };
}

/** The default wiring: every built-in env provider plus BYOK protocols. */
export const defaultProviderRegistry = new ProviderRegistry();

/** The env var backing a builtin provider, if one exists (catalogue availability). */
export function envApiKeyForProtocol(protocol: string): string | undefined {
    if (protocol === "anthropic") return process.env.ANTHROPIC_API_KEY;
    if (protocol === "google") return process.env.GOOGLE_API_KEY;
    const entry = OPENAI_COMPATIBLE_PROVIDERS[protocol as keyof typeof OPENAI_COMPATIBLE_PROVIDERS];
    return entry ? process.env[entry.envVar] : undefined;
}

function registerDefaults(): void {
    defaultProviderRegistry.register(createOpenAICompatiblePlugin());
    defaultProviderRegistry.register(createAnthropicPlugin());
    defaultProviderRegistry.register(createGooglePlugin());
}

registerDefaults();