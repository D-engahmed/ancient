// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

export type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type SupportedProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "deepseek"
  | "mistral"
  | "groq"
  | "together"
  | "ollama"
  | "lmstudio"
  | "vllm"
  | "custom";

type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
};

export const SUPPORTED_CHAT_MODELS = [
  // ---- OpenAI ----
  { id: "gpt-5.6-sol", provider: "openai", pricing: { inputUsdPerMillionTokens: 4, outputUsdPerMillionTokens: 20 } },
  { id: "gpt-5.5", provider: "openai", pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 } },
  { id: "gpt-5.4", provider: "openai", pricing: { inputUsdPerMillionTokens: 2.5, outputUsdPerMillionTokens: 15 } },
  { id: "gpt-5.4-mini", provider: "openai", pricing: { inputUsdPerMillionTokens: 0.75, outputUsdPerMillionTokens: 4.5 } },
  { id: "gpt-5.4-nano", provider: "openai", pricing: { inputUsdPerMillionTokens: 0.2, outputUsdPerMillionTokens: 1.25 } },
  { id: "gpt-5.2", provider: "openai", pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 12 } },
  { id: "gpt-5.1", provider: "openai", pricing: { inputUsdPerMillionTokens: 1.5, outputUsdPerMillionTokens: 8 } },
  { id: "gpt-4.1", provider: "openai", pricing: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 5 } },
  { id: "gpt-4.1-mini", provider: "openai", pricing: { inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 1.5 } },
  { id: "gpt-4o", provider: "openai", pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 15 } },
  { id: "gpt-4o-mini", provider: "openai", pricing: { inputUsdPerMillionTokens: 0.15, outputUsdPerMillionTokens: 0.6 } },
  { id: "o4-mini", provider: "openai", pricing: { inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 1.2 } },
  { id: "o3-mini", provider: "openai", pricing: { inputUsdPerMillionTokens: 0.15, outputUsdPerMillionTokens: 0.6 } },
  { id: "o1", provider: "openai", pricing: { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 2 } },

  // ---- Anthropic ----
  { id: "claude-sonnet-5", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 10 } },
  { id: "claude-opus-4-8", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 25 } },
  { id: "claude-opus-4-6", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 25 } },
  { id: "claude-sonnet-4-6", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 } },
  { id: "claude-haiku-4-5", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 5 } },
  { id: "claude-opus-4-5", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 4, outputUsdPerMillionTokens: 20 } },
  { id: "claude-sonnet-4-5", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 2.5, outputUsdPerMillionTokens: 12 } },
  { id: "claude-3-7-sonnet-20250219", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 } },
  { id: "claude-3-5-sonnet-20241022", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 } },

  // ---- Google Gemini ----
  // NOTE: keep this in sync with providers.ts's Gemini suggestion list.
  // gemini-3.6-flash / 3.5-flash-lite / 3.1-pro-preview were removed there
  // because they fail validation against the live API (see providers.ts) —
  // they must not reappear here as if they were valid, priced models.
  { id: "gemini-3.7-flash", provider: "google", pricing: { inputUsdPerMillionTokens: 0.15, outputUsdPerMillionTokens: 0.6 } },
  { id: "gemini-2.5-flash", provider: "google", pricing: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 5 } },
  // TODO: add gemini-2.5-pro with real pricing — it's in providers.ts's
  // suggestion list but has no entry (and therefore no cost tracking) here.

  // ---- DeepSeek ----
  { id: "deepseek-v4", provider: "deepseek", pricing: { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 2 } },
  { id: "deepseek-v3.2", provider: "deepseek", pricing: { inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 1.2 } },

  // ---- Mistral AI ----
  { id: "mistral-medium-3.5", provider: "mistral", pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 6 } },
  { id: "mistral-small-4", provider: "mistral", pricing: { inputUsdPerMillionTokens: 0.2, outputUsdPerMillionTokens: 0.6 } },
  { id: "mistral-large-3", provider: "mistral", pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 6 } },

  // ---- Groq ----
  { id: "llama-3.3-70b-groq", provider: "groq", pricing: { inputUsdPerMillionTokens: 0.59, outputUsdPerMillionTokens: 0.79 } },
  { id: "llama-4-scout-groq", provider: "groq", pricing: { inputUsdPerMillionTokens: 0.2, outputUsdPerMillionTokens: 0.6 } },
  { id: "llama-4-maverick-groq", provider: "groq", pricing: { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 1.5 } },
  { id: "gpt-oss-groq", provider: "groq", pricing: { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 1.5 } },

  // ---- Together ----
  { id: "llama-3.3-together", provider: "together", pricing: { inputUsdPerMillionTokens: 0.9, outputUsdPerMillionTokens: 0.9 } },
  { id: "qwen-together", provider: "together", pricing: { inputUsdPerMillionTokens: 0.9, outputUsdPerMillionTokens: 0.9 } },
  { id: "deepseek-together", provider: "together", pricing: { inputUsdPerMillionTokens: 0.9, outputUsdPerMillionTokens: 0.9 } },
  { id: "gpt-oss-together", provider: "together", pricing: { inputUsdPerMillionTokens: 0.9, outputUsdPerMillionTokens: 0.9 } },

  // ---- Local / self-hosted (pricing = 0) ----
  { id: "ollama-default", provider: "ollama", pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 } },
  { id: "lmstudio-default", provider: "lmstudio", pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 } },
  { id: "vllm-default", provider: "vllm", pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 } },
  { id: "custom-default", provider: "custom", pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 } },
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(modelId: string) {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "gpt-5.6-sol";