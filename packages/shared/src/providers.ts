// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

export type ProviderModel = { id: string; label: string };

export type ProviderDefinition = {
    id: string;
    label: string;
    protocol: "openai" | "anthropic" | "gemini";
    defaultBaseUrl: string;
    defaultModelId?: string;
    description: string;
    models: ProviderModel[];
};

export const PROVIDERS = [
    {
        id: "openai", label: "OpenAI", protocol: "openai" as const,
        defaultBaseUrl: "https://api.openai.com/v1", defaultModelId: "gpt-5.6-sol",
        description: "GPT-5.6, o-series, GPT-4.1",
        models: [
            { id: "gpt-5.6-sol", label: "GPT-5.6 Sol (flagship)" },
            { id: "gpt-5.5", label: "GPT-5.5" },
            { id: "gpt-5.4", label: "GPT-5.4" },
            { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
            { id: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
            { id: "gpt-5.2", label: "GPT-5.2" },
            { id: "gpt-5.1", label: "GPT-5.1" },
            { id: "gpt-4.1", label: "GPT-4.1" },
            { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
            { id: "o4-mini", label: "o4-mini (reasoning)" },
            { id: "o3-mini", label: "o3-mini (fast reasoning)" },
            { id: "o1", label: "o1 (reasoning)" },
        ],
    },
    {
        id: "anthropic", label: "Anthropic", protocol: "anthropic" as const,
        defaultBaseUrl: "https://api.anthropic.com", defaultModelId: "claude-fable-5",
        description: "Claude Fable 5, Opus 4.8, Sonnet 5, Haiku 4.5",
        models: [
            { id: "claude-fable-5", label: "Claude Fable 5 (most capable)" },
            { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
            { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
            { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
            { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
            { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest)" },
            { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
            { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
            { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
            { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
        ],
    },
    {
        id: "gemini", label: "Google Gemini", protocol: "gemini" as const,
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModelId: "gemini-3.6-flash",
        description: "Gemini 3.6 Flash, 3.5 Flash-Lite, 3.1 Pro",
        models: [
            { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (GA)" },
            { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (fastest)" },
            { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview, 2M ctx)" },
            { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (GA)" },
            { id: "gemini-2.5-flash", label: "Gemini 2 Flash (GA)" },
        ],
    },
    {
        id: "deepseek", label: "DeepSeek", protocol: "openai" as const,
        defaultBaseUrl: "https://api.deepseek.com/v1", defaultModelId: "deepseek-v4-pro",
        description: "DeepSeek-V4, V3.2",
        models: [
            { id: "deepseek-v4-pro", label: "DeepSeek-V4 Pro (flagship reasoning)" },
            { id: "deepseek-v4-flash", label: "DeepSeek-V4 Flash (fast, cheap)" },
            { id: "deepseek-v3.2", label: "DeepSeek-V3.2" },
        ],
    },
    {
        id: "mistral", label: "Mistral AI", protocol: "openai" as const,
        defaultBaseUrl: "https://api.mistral.ai/v1", defaultModelId: "mistral-medium-3.5",
        description: "Mistral Medium 3.5, Small 4, Large 3",
        models: [
            { id: "mistral-medium-3.5", label: "Mistral Medium 3.5" },
            { id: "mistral-small-4", label: "Mistral Small 4" },
            { id: "mistral-large-3", label: "Mistral Large 3 (262K ctx)" },
            { id: "codestral-latest", label: "Codestral (latest)" },
            { id: "devstral-2512", label: "Devstral 2512" },
        ],
    },
    {
        id: "groq", label: "Groq", protocol: "openai" as const,
        defaultBaseUrl: "https://api.groq.com/openai/v1", defaultModelId: "llama-3.3-70b-versatile",
        description: "Llama 3.3 70B, Llama 4 Scout/Maverick, GPT-OSS",
        models: [
            { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (recommended)" },
            { id: "llama-4-scout-17b-16e", label: "Llama 4 Scout 17B (16E)" },
            { id: "llama-4-maverick-17b-128e", label: "Llama 4 Maverick 17B (128E)" },
        ],
    },
    {
        id: "together", label: "Together AI", protocol: "openai" as const,
        defaultBaseUrl: "https://api.together.xyz/v1", defaultModelId: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        description: "Llama 3.3, Qwen, DeepSeek, GPT-OSS, Nemotron",
        models: [
            { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B (Turbo)" },
            { id: "Qwen/Qwen3.7-Max", label: "Qwen 3.7 Max" },
            { id: "deepseek-ai/DeepSeek-V4-Pro", label: "DeepSeek-V4 Pro" },
        ],
    },
    {
        id: "ollama", label: "Ollama (local)", protocol: "openai" as const,
        defaultBaseUrl: "http://localhost:11434/v1", defaultModelId: "llama3.2",
        description: "Local models via Ollama",
        models: [
            { id: "llama3.2", label: "Llama 3.2" },
            { id: "llama3.1", label: "Llama 3.1" },
            { id: "mistral", label: "Mistral" },
        ],
    },
    {
        id: "lmstudio", label: "LM Studio (local)", protocol: "openai" as const,
        defaultBaseUrl: "http://localhost:1234/v1", defaultModelId: "lmstudio-community/Meta-Llama-3-8B-Instruct",
        description: "Local models via LM Studio",
        models: [
            { id: "lmstudio-community/Meta-Llama-3-8B-Instruct", label: "Llama 3 8B (LM Studio)" },
            { id: "lmstudio-community/Meta-Llama-3-70B-Instruct", label: "Llama 3 70B (LM Studio)" },
        ],
    },
    {
        id: "vllm", label: "vLLM (local)", protocol: "openai" as const,
        defaultBaseUrl: "http://localhost:8000/v1", defaultModelId: "meta-llama/Llama-3-8B-Instruct",
        description: "Self‑hosted vLLM server",
        models: [
            { id: "meta-llama/Llama-3-8B-Instruct", label: "Llama 3 8B" },
            { id: "mistralai/Mistral-7B-Instruct-v0.3", label: "Mistral 7B" },
        ],
    },
    {
        id: "custom", label: "Custom OpenAI-compatible", protocol: "openai" as const,
        defaultBaseUrl: "", defaultModelId: "",
        description: "Any OpenAI-compatible endpoint",
        models: [{ id: "", label: "Custom (type model ID manually)" }],
    },
] as const satisfies readonly ProviderDefinition[];

export function getProviderModelIds(providerId: string): string[] {
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return [];
    if (provider.models.length === 1 && provider.models[0]!.id === "") return [];
    return provider.models.map((m) => m.id);
}

export function getProvider(providerId: string): ProviderDefinition | undefined {
    return PROVIDERS.find((p) => p.id === providerId);
}

export function isValidModelForProtocol(protocol: string, modelId: string): boolean {
    const protocolToProviderId: Record<string, string> = {
        openai: "openai", anthropic: "anthropic", gemini: "gemini",
    };
    const providerId = protocolToProviderId[protocol];
    if (!providerId) return false;
    const ids = getProviderModelIds(providerId);
    if (ids.length === 0) return true;
    return ids.some((id) => id.toLowerCase() === modelId.toLowerCase());
}