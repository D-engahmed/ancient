// packages/shared/src/providers.ts

export type ProviderModel = {
    id: string;
    label: string;
};

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
        id: "openai",
        label: "OpenAI",
        protocol: "openai" as const,
        defaultBaseUrl: "https://api.openai.com/v1",
        defaultModelId: "gpt-5.6-sol",
        description: "GPT-5.6, o-series, GPT-4.1",
        models: [
            { id: "gpt-5.6-sol", label: "GPT-5.6 Sol (flagship)" },
            { id: "gpt-5.5", label: "GPT-5.5" },
            { id: "gpt-5.5-instant", label: "GPT-5.5 Instant" },
            { id: "gpt-5.4", label: "GPT-5.4" },
            { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
            { id: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
            { id: "gpt-5.3-instant", label: "GPT-5.3 Instant" },
            { id: "gpt-5.2", label: "GPT-5.2" },
            { id: "gpt-5.1", label: "GPT-5.1" },
            { id: "gpt-5", label: "GPT-5" },
            { id: "gpt-5-mini", label: "GPT-5 Mini" },
            { id: "gpt-5-nano", label: "GPT-5 Nano" },
            { id: "gpt-4.1", label: "GPT-4.1" },
            { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
            { id: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
            { id: "o4-mini", label: "o4-mini (reasoning)" },
            { id: "o3-mini", label: "o3-mini (fast reasoning)" },
            { id: "o1", label: "o1 (reasoning)" },
        ],
    },
    {
        id: "anthropic",
        label: "Anthropic",
        protocol: "anthropic" as const,
        defaultBaseUrl: "https://api.anthropic.com",
        defaultModelId: "claude-fable-5",
        description: "Claude Fable 5, Opus 4.8, Sonnet 5, Haiku 4.5",
        models: [
            { id: "claude-fable-5", label: "Claude Fable 5 (most capable)" },
            { id: "claude-mythos-5", label: "Claude Mythos 5 (limited availability)" },
            { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
            { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
            { id: "claude-sonnet-5", label: "Claude Sonnet 5 (best speed/intelligence)" },
            { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
            { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest)" },
            { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
            { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
            { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
            { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
        ],
    },
    {
        id: "gemini",
        label: "Google Gemini",
        protocol: "gemini" as const,
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        defaultModelId: "gemini-3.6-flash",
        description: "Gemini 3.6 Flash, 3.5 Flash-Lite, 3.1 Pro",
        models: [
            { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (GA)" },
            { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (fastest)" },
            { id: "gemini-3.5-flash-cyber", label: "Gemini 3.5 Flash Cyber" },
            { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview, 2M ctx)" },
            { id: "gemini-3.1-flash-preview", label: "Gemini 3.1 Flash (preview)" },
            { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite" },
            { id: "gemini-3-pro-preview", label: "Gemini 3 Pro (preview)" },
            { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
            { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (GA)" },
            { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (GA)" },
            { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
        ],
    },
    {
        id: "deepseek",
        label: "DeepSeek",
        protocol: "openai" as const,
        defaultBaseUrl: "https://api.deepseek.com/v1",
        defaultModelId: "deepseek-v4-pro",
        description: "DeepSeek-V4, V3.2",
        models: [
            { id: "deepseek-v4-pro", label: "DeepSeek-V4 Pro (flagship reasoning)" },
            { id: "deepseek-v4-flash", label: "DeepSeek-V4 Flash (fast, cheap)" },
            { id: "deepseek-v3.2", label: "DeepSeek-V3.2" },
        ],
    },
    {
        id: "mistral",
        label: "Mistral AI",
        protocol: "openai" as const,
        defaultBaseUrl: "https://api.mistral.ai/v1",
        defaultModelId: "mistral-medium-3.5",
        description: "Mistral Medium 3.5, Small 4, Large 3",
        models: [
            { id: "mistral-medium-3.5", label: "Mistral Medium 3.5" },
            { id: "mistral-small-4", label: "Mistral Small 4" },
            { id: "mistral-large-3", label: "Mistral Large 3 (262K ctx)" },
            { id: "mistral-small-3.2", label: "Mistral Small 3.2" },
            { id: "codestral-2508", label: "Codestral-2508 (code specialist)" },
            { id: "codestral-latest", label: "Codestral (latest)" },
            { id: "devstral-2512", label: "Devstral 2512" },
            { id: "voxtral-mini-2507", label: "Voxtral Mini Transcribe" },
        ],
    },
    {
        id: "groq",
        label: "Groq",
        protocol: "openai" as const,
        defaultBaseUrl: "https://api.groq.com/openai/v1",
        defaultModelId: "llama-3.3-70b-versatile",
        description: "Llama 3.3 70B, Llama 4 Scout/Maverick, GPT-OSS",
        models: [
            { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (recommended)" },
            { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
            { id: "llama-3.2-3b-preview", label: "Llama 3.2 3B Preview" },
            { id: "llama-4-scout-17b-16e", label: "Llama 4 Scout 17B (16E)" },
            { id: "llama-4-maverick-17b-128e", label: "Llama 4 Maverick 17B (128E)" },
            { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
            { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
            { id: "qwen-2.5-32b", label: "Qwen 2.5 32B" },
        ],
    },
    {
        id: "cohere",
        label: "Cohere",
        protocol: "openai" as const,
        defaultBaseUrl: "https://api.cohere.ai/v1",
        defaultModelId: "command-a-plus-05-2026",
        description: "Command A+, Command A, Command R+",
        models: [
            { id: "command-a-plus-05-2026", label: "Command A+ (latest)" },
            { id: "command-a", label: "Command A" },
            { id: "command-a-vision", label: "Command A Vision" },
            { id: "command-r-plus-08-2024", label: "Command R+ (08-2024)" },
            { id: "command-r", label: "Command R" },
        ],
    },
    {
        id: "together",
        label: "Together AI",
        protocol: "openai" as const,
        defaultBaseUrl: "https://api.together.xyz/v1",
        defaultModelId: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        description: "Llama 3.3, Qwen, DeepSeek, GPT-OSS, Nemotron",
        models: [
            { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B (Turbo)" },
            { id: "Qwen/Qwen3.7-Max", label: "Qwen 3.7 Max" },
            { id: "Qwen/Qwen3.6-Plus", label: "Qwen 3.6 Plus (1M ctx)" },
            { id: "Qwen/Qwen3.5-9B", label: "Qwen 3.5 9B" },
            { id: "deepseek-ai/DeepSeek-V4-Pro", label: "DeepSeek-V4 Pro" },
            { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
            { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
            { id: "nvidia/nemotron-3-ultra-550b-a55b", label: "Nemotron 3 Ultra 550B" },
            { id: "moonshotai/Kimi-K2.7-Code", label: "Kimi K2.7 Code" },
            { id: "moonshotai/Kimi-K2.6", label: "Kimi K2.6" },
            { id: "MiniMaxAI/MiniMax-M3", label: "MiniMax M3" },
            { id: "MiniMaxAI/MiniMax-M2.7", label: "MiniMax M2.7" },
            { id: "zai-org/GLM-5.2", label: "GLM-5.2" },
            { id: "thinkingmachines/Inkling", label: "Inkling" },
            { id: "google/gemma-4-31B-it", label: "Gemma 4 31B" },
        ],
    },
    {
        id: "ollama",
        label: "Ollama (local)",
        protocol: "openai" as const,
        defaultBaseUrl: "http://localhost:11434/v1",
        defaultModelId: "llama3.2",
        description: "Local models via Ollama",
        models: [
            { id: "llama3.2", label: "Llama 3.2" },
            { id: "llama3.1", label: "Llama 3.1" },
            { id: "phi3", label: "Phi-3" },
            { id: "gemma2", label: "Gemma 2" },
            { id: "mistral", label: "Mistral" },
            { id: "mixtral", label: "Mixtral" },
            { id: "codellama", label: "Code Llama" },
        ],
    },
    {
        id: "lmstudio",
        label: "LM Studio (local)",
        protocol: "openai" as const,
        defaultBaseUrl: "http://localhost:1234/v1",
        defaultModelId: "lmstudio-community/Meta-Llama-3-8B-Instruct",
        description: "Local models via LM Studio",
        models: [
            { id: "lmstudio-community/Meta-Llama-3-8B-Instruct", label: "Llama 3 8B (LM Studio)" },
            { id: "lmstudio-community/Meta-Llama-3-70B-Instruct", label: "Llama 3 70B (LM Studio)" },
            { id: "lmstudio-community/Mistral-7B-Instruct-v0.3", label: "Mistral 7B (LM Studio)" },
            { id: "lmstudio-community/Phi-3-mini-4k-instruct", label: "Phi-3 Mini (LM Studio)" },
        ],
    },
    {
        id: "vllm",
        label: "vLLM (local)",
        protocol: "openai" as const,
        defaultBaseUrl: "http://localhost:8000/v1",
        defaultModelId: "meta-llama/Llama-3-8B-Instruct",
        description: "Self‑hosted vLLM server",
        models: [
            { id: "meta-llama/Llama-3-8B-Instruct", label: "Llama 3 8B" },
            { id: "meta-llama/Llama-3-70B-Instruct", label: "Llama 3 70B" },
            { id: "mistralai/Mistral-7B-Instruct-v0.3", label: "Mistral 7B" },
            { id: "Qwen/Qwen2.5-7B-Instruct", label: "Qwen 2.5 7B" },
            { id: "google/gemma-2-9b-it", label: "Gemma 2 9B" },
        ],
    },
    {
        id: "custom",
        label: "Custom OpenAI-compatible",
        protocol: "openai" as const,
        defaultBaseUrl: "",
        defaultModelId: "",
        description: "Any OpenAI-compatible endpoint",
        models: [{ id: "", label: "Custom (type model ID manually)" }],
    },
] as const satisfies readonly ProviderDefinition[];

// Helper to get all model IDs for a provider (lowercased for easy lookup)
export function getProviderModelIds(providerId: string): string[] {
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return [];
    // If the provider has a single model with empty ID (like "custom"), return empty array
    // which means "any" is allowed
    if (provider.models.length === 1 && provider.models[0]!.id === "") {
        return [];
    }
    return provider.models.map((m) => m.id);
}

// Helper to get a provider by ID
export function getProvider(providerId: string): ProviderDefinition | undefined {
    return PROVIDERS.find((p) => p.id === providerId);
}

// Helper to check if a model ID is valid for a given protocol
export function isValidModelForProtocol(protocol: string, modelId: string): boolean {
    const protocolToProviderId: Record<string, string> = {
        openai: "openai",
        anthropic: "anthropic",
        gemini: "gemini",
    };
    const providerId = protocolToProviderId[protocol];
    if (!providerId) return false;
    const ids = getProviderModelIds(providerId);
    if (ids.length === 0) return true; // wildcard – accept anything
    return ids.some((id) => id.toLowerCase() === modelId.toLowerCase());
}