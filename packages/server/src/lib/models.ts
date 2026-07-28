import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { mistral } from "@ai-sdk/mistral";
import { cohere } from "@ai-sdk/cohere";
// Option 1: use the official DeepSeek provider (recommended)
import { deepseek } from "@ai-sdk/deepseek";
import type { ProviderOptions } from "@ai-sdk/provider-utils"
// Option 2 (fallback): if @ai-sdk/deepseek is not available, you can use openai with a custom baseURL:
// import { openai } from "@ai-sdk/openai";
// const deepseekProvider = openai({ baseURL: "https://api.deepseek.com/v1" });

import {
    findSupportedChatModel,
    type SupportedChatModel,
    type SupportedChatModelId,
    type SupportedProvider,
} from "@ANCIENT/shared";
import type { LanguageModel } from "ai";
import { RouterProvider } from 'react-router';

// Type helpers for each provider's model IDs
type AnthropicModelId = Extract<SupportedChatModel, { provider: "anthropic" }>["id"];
type OpenAIModelId = Extract<SupportedChatModel, { provider: "openai" }>["id"];
type GoogleModelId = Extract<SupportedChatModel, { provider: "google" }>["id"];
type MistralModelId = Extract<SupportedChatModel, { provider: "mistral" }>["id"];
type CohereModelId = Extract<SupportedChatModel, { provider: "cohere" }>["id"];
type DeepSeekModelId = Extract<SupportedChatModel, { provider: "deepseek" }>["id"];
type AunModelId = Extract<SupportedChatModel, { provider: "aun" }>["id"];

export type ResolvedModel = {
    model: LanguageModel;
    provider: SupportedProvider;
    modelId: SupportedChatModelId;
    providerOptions?: ProviderOptions;
};

const ANTHROPIC_PROVIDER_OPTIONS: Partial<Record<AnthropicModelId, ProviderOptions>> = {
    "claude-opus-4-6": {
        anthropic: {
            thinking: {
                type: "enabled",
                budgetTokens: 10000,
            }
        },
    },
    "claude-sonnet-4-6": {
        anthropic: {
            thinking: {
                type: "enabled",
                budgetTokens: 10000,
            },
        },
    },
};

const OPENAI_PROVIDER_OPTIONS: Partial<Record<OpenAIModelId, ProviderOptions>> = {
    "gpt-5.4": {
        openai: {
            thinking: {
                reasoningSummary: "detailed",
            }
        },
    },
};


function assertUnsupportedProvider(provider: never): never {
    throw new Error(`Unsupported provider: ${provider}`);
}

// Resolver for each provider
function resolveAnthropicModel(modelId: AnthropicModelId): ResolvedModel {
    return {
        model: anthropic(modelId),
        provider: "anthropic",
        modelId,
        providerOptions: ANTHROPIC_PROVIDER_OPTIONS[modelId],
    };
}

function resolveOpenAIModel(modelId: OpenAIModelId): ResolvedModel {
    return {
        model: openai(modelId),
        provider: "openai",
        modelId,
        providerOptions: OPENAI_PROVIDER_OPTIONS[modelId],
    };
}

function resolveGoogleModel(modelId: GoogleModelId): ResolvedModel {
    return {
        model: google(modelId),
        provider: "google",
        modelId,
    };
}

function resolveMistralModel(modelId: MistralModelId): ResolvedModel {
    return {
        model: mistral(modelId),
        provider: "mistral",
        modelId,
    };
}

function resolveCohereModel(modelId: CohereModelId): ResolvedModel {
    return {
        model: cohere(modelId),
        provider: "cohere",
        modelId,
    };
}

function resolveDeepSeekModel(modelId: DeepSeekModelId): ResolvedModel {
    // If using @ai-sdk/deepseek:
    return {
        model: deepseek(modelId),
        provider: "deepseek",
        modelId,
    };
    // Alternative (if using openai with custom baseURL):
    // const deepseekProvider = openai({ baseURL: "https://api.deepseek.com/v1" });
    // return {
    //     model: deepseekProvider(modelId),
    //     provider: "deepseek",
    //     modelId,
    // };
}

function resolveAunModel(modelId: AunModelId): ResolvedModel {
    // Placeholder for your custom "aun" provider.
    // Replace this with your actual integration when ready.
    throw new Error(`Aun provider is not yet implemented. Model: ${modelId}`);
    // If you have a custom LanguageModel implementation, you could return it here.
    // For now, we throw to avoid silent failures.
}

function resolveSupportedChatModel(model: SupportedChatModel): ResolvedModel {
    const provider = model.provider;

    switch (provider) {
        case "anthropic":
            return resolveAnthropicModel(model.id);
        case "openai":
            return resolveOpenAIModel(model.id);
        case "google":
            return resolveGoogleModel(model.id);
        case "mistral":
            return resolveMistralModel(model.id);
        case "cohere":
            return resolveCohereModel(model.id);
        case "deepseek":
            return resolveDeepSeekModel(model.id);
        case "aun":
            return resolveAunModel(model.id);
        default:
            return assertUnsupportedProvider(provider);
    }
}

export function isSupportedChatModel(modelId: string): modelId is SupportedChatModelId {
    return findSupportedChatModel(modelId) != null;
}

export function resolveChatModel(modelId: string): ResolvedModel {
    const model = findSupportedChatModel(modelId);
    if (!model) {
        throw new Error(`Unsupported model: ${modelId}`);
    }
    return resolveSupportedChatModel(model);
}