// provider-selection-dialog.tsx
import { useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";
import { AddProviderConnectionDialog } from "./add-provider-connection-dialog";

export const PROVIDERS = [
    {
        id: "openai",
        label: "OpenAI",
        protocol: "openai" as const,
        defaultBaseUrl: "https://api.openai.com/v1",
        defaultModelId: "gpt-4o-mini",
        description: "ChatGPT, GPT-4, o1 models",
        models: [
            { id: "gpt-4o", label: "GPT-4o (latest)" },
            { id: "gpt-4o-mini", label: "GPT-4o Mini" },
            { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
            { id: "gpt-4", label: "GPT-4 (legacy)" },
            { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
            { id: "o1-mini", label: "o1-mini" },
            { id: "o1-preview", label: "o1-preview" },
            { id: "o3-mini", label: "o3-mini" },
        ],
    },
    {
        id: "anthropic",
        label: "Anthropic",
        protocol: "anthropic" as const,
        defaultBaseUrl: "https://api.anthropic.com",
        defaultModelId: "claude-3-5-sonnet-20241022",
        description: "Claude 3.5, Opus, Sonnet",
        models: [
            { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
            { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
            { id: "claude-3-sonnet-20240229", label: "Claude 3 Sonnet" },
            { id: "claude-3-haiku-20240307", label: "Claude 3 Haiku" },
            { id: "claude-2.1", label: "Claude 2.1" },
            { id: "claude-2.0", label: "Claude 2.0" },
        ],
    },
    {
        id: "gemini",
        label: "Google Gemini",
        protocol: "gemini" as const,
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        defaultModelId: "gemini-3.6-flash",
        description: "Gemini 2.0, 1.5 Pro/Flash",
        models: [
            { id: "gemini-3.6-flash-exp", label: "Gemini 3.6 Flash" },
            { id: "gemini-3.0-pro-exp", label: "Gemini 3.0 Pro (experimental)" },
            { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
            { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
            { id: "gemini-1.0-pro", label: "Gemini 1.0 Pro" },
        ],
    },
    {
        id: "deepseek",
        label: "DeepSeek",
        protocol: "openai" as const,
        defaultBaseUrl: "https://api.deepseek.com/v1",
        defaultModelId: "deepseek-chat",
        description: "DeepSeek-V3, DeepSeek-R1",
        models: [
            { id: "deepseek-chat", label: "DeepSeek-V3 (chat)" },
            { id: "deepseek-reasoner", label: "DeepSeek-R1 (reasoner)" },
        ],
    },
    {
        id: "mistral",
        label: "Mistral AI",
        protocol: "openai" as const,
        defaultBaseUrl: "https://api.mistral.ai/v1",
        defaultModelId: "mistral-large-latest",
        description: "Mistral Large, Small, Codestral",
        models: [
            { id: "mistral-large-latest", label: "Mistral Large (latest)" },
            { id: "mistral-small-latest", label: "Mistral Small" },
            { id: "codestral-latest", label: "Codestral" },
            { id: "mistral-embed", label: "Mistral Embed" },
        ],
    },
    {
        id: "cohere",
        label: "Cohere",
        protocol: "openai" as const,
        defaultBaseUrl: "https://api.cohere.ai/v1",
        defaultModelId: "command-r-plus",
        description: "Command R, R+",
        models: [
            { id: "command-r-plus", label: "Command R+" },
            { id: "command-r", label: "Command R" },
        ],
    },
    {
        id: "groq",
        label: "Groq",
        protocol: "openai" as const,
        defaultBaseUrl: "https://api.groq.com/openai/v1",
        defaultModelId: "llama3-70b-8192",
        description: "Llama 3, Mixtral on Groq",
        models: [
            { id: "llama3-70b-8192", label: "Llama 3 70B" },
            { id: "llama3-8b-8192", label: "Llama 3 8B" },
            { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
            { id: "gemma2-9b-it", label: "Gemma 2 9B" },
        ],
    },
    {
        id: "together",
        label: "Together AI",
        protocol: "openai" as const,
        defaultBaseUrl: "https://api.together.xyz/v1",
        defaultModelId: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        description: "Llama, Mistral, Qwen on Together",
        models: [
            { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B" },
            { id: "meta-llama/Llama-3-70B-Instruct-Turbo", label: "Llama 3 70B" },
            { id: "mistralai/Mixtral-8x7B-Instruct-v0.1", label: "Mixtral 8x7B" },
            { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", label: "Qwen 2.5 72B" },
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
        ],
    },
    {
        id: "custom",
        label: "Custom OpenAI-compatible",
        protocol: "openai" as const,
        defaultBaseUrl: "",
        defaultModelId: "",
        description: "Any OpenAI-compatible endpoint",
        models: [
            { id: "", label: "Custom (type model ID manually)" },
        ],
    },
] as const;

export type Provider = (typeof PROVIDERS)[number];

export const ProviderSelectionDialog = () => {
    const dialog = useDialog();

    const handleSelect = useCallback(
        (provider: Provider) => {
            dialog.open({
                title: `Add ${provider.label} Connection`,
                children: <AddProviderConnectionDialog provider={provider} />,
            });
        },
        [dialog],
    );

    return (
        <box flexDirection="column" gap={1}>
            <DialogSearchList
                items={PROVIDERS}
                onSelect={handleSelect}
                filterFn={(provider, query) =>
                    provider.label.toLowerCase().includes(query.toLowerCase()) ||
                    provider.description.toLowerCase().includes(query.toLowerCase()) ||
                    provider.id.toLowerCase().includes(query.toLowerCase())
                }
                renderItem={(provider, isSelected) => (
                    <box flexDirection="row" flexGrow={1} overflow="hidden" width="100%">
                        <text selectable={false} fg={isSelected ? "black" : "white"}>
                            {provider.label}
                        </text>
                        <box flexGrow={1} />
                        <text
                            selectable={false}
                            attributes={TextAttributes.DIM}
                            fg={isSelected ? "black" : undefined}
                        >
                            {provider.description}
                        </text>
                    </box>
                )}
                getKey={(provider) => provider.id}
                placeholder="Search providers (OpenAI, Anthropic, ...)"
                emptyText="No matching providers"
            />
        </box>
    );
};