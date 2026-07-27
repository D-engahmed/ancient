export type ModelPricing = {
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
};

export type SupportedProvider =
    | "anthropic"
    | "openai"
    | "google"
    | "mistral"
    | "cohere"
    | "deepseek"
    | "aun"; // your custom provider

type SupportedChatModelDefinition = {
    id: string;
    provider: SupportedProvider;
    pricing: ModelPricing;
};

export const SUPPORTED_CHAT_MODELS = [
    // Anthropic
    {
        id: "claude-sonnet-4-6",
        provider: "anthropic",
        pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
    },
    {
        id: "claude-haiku-4-5",
        provider: "anthropic",
        pricing: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 5 },
    },
    {
        id: "claude-opus-4-6",
        provider: "anthropic",
        pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 25 },
    },

    // OpenAI
    {
        id: "gpt-5.4",
        provider: "openai",
        pricing: { inputUsdPerMillionTokens: 2.5, outputUsdPerMillionTokens: 15 },
    },
    {
        id: "gpt-5.4-mini",
        provider: "openai",
        pricing: { inputUsdPerMillionTokens: 0.75, outputUsdPerMillionTokens: 4.5 },
    },
    {
        id: "gpt-5.4-nano",
        provider: "openai",
        pricing: { inputUsdPerMillionTokens: 0.2, outputUsdPerMillionTokens: 1.25 },
    },


    // Google
    {
        id: "gemini-3.6-flash",
        provider: "google",
        pricing: { inputUsdPerMillionTokens: 0.30, outputUsdPerMillionTokens: 2.50 },
    },
    {
        id: "gemini-3.6-flash-lite",
        provider: "google",
        pricing: { inputUsdPerMillionTokens: 0.10, outputUsdPerMillionTokens: 0.40 },
    },

    // Mistral
    {
        id: "mistral-large-2407",
        provider: "mistral",
        pricing: { inputUsdPerMillionTokens: 4.0, outputUsdPerMillionTokens: 12.0 },
    },
    {
        id: "mistral-small-2407",
        provider: "mistral",
        pricing: { inputUsdPerMillionTokens: 1.0, outputUsdPerMillionTokens: 3.0 },
    },
    {
        id: "mistral-8x7b",
        provider: "mistral",
        pricing: { inputUsdPerMillionTokens: 0.2, outputUsdPerMillionTokens: 0.6 },
    },

    // Cohere
    {
        id: "command-r-plus",
        provider: "cohere",
        pricing: { inputUsdPerMillionTokens: 2.5, outputUsdPerMillionTokens: 10.0 },
    },
    {
        id: "command-r",
        provider: "cohere",
        pricing: { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 1.5 },
    },

    // DeepSeek
    {
        id: "deepseek-chat",
        provider: "deepseek",
        pricing: { inputUsdPerMillionTokens: 0.14, outputUsdPerMillionTokens: 0.28 },
    },
    {
        id: "deepseek-coder",
        provider: "deepseek",
        pricing: { inputUsdPerMillionTokens: 0.14, outputUsdPerMillionTokens: 0.28 },
    },

    // Your custom "aun" models (placeholder pricing)
    {
        id: "aun-model-1",
        provider: "aun",
        pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    },
    {
        id: "aun-model-2",
        provider: "aun",
        pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    },
    {
        id: "aun-model-3",
        provider: "aun",
        pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    },
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(modelId: string) {
    return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "gemini-3.6-flash";