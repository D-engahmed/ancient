// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

export type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type SupportedProvider = "anthropic" | "openai";

type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
};

export const SUPPORTED_CHAT_MODELS = [
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
  { id: "claude-sonnet-5", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 10 } },
  { id: "claude-opus-4-8", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 25 } },
  { id: "claude-opus-4-6", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 25 } },
  { id: "claude-sonnet-4-6", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 } },
  { id: "claude-haiku-4-5", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 5 } },
  { id: "claude-opus-4-5", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 4, outputUsdPerMillionTokens: 20 } },
  { id: "claude-sonnet-4-5", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 2.5, outputUsdPerMillionTokens: 12 } },
  { id: "claude-3-7-sonnet-20250219", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 } },
  { id: "claude-3-5-sonnet-20241022", provider: "anthropic", pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 } },
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(modelId: string) {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "gpt-5.6-sol";