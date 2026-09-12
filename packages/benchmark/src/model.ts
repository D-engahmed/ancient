// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Real-model resolution for the benchmark (benchmark/model).
//
// The benchmark must drive REAL models (the exit criterion), but it must stay
// independent of the server package (which would drag in Hono + the Prisma
// client). This mirrors the *env-key path* of the server's provider registry —
// same SDKs, same env vars, same provider catalog — for exactly one model id
// at a time. A run without the required key fails fast with an actionable
// message instead of faking a model.

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { findSupportedChatModel, DEFAULT_CHAT_MODEL_ID, type SupportedChatModel } from "@ANCIENT/shared";

/** Env var backing each builtin provider's platform-billed key. */
function envKeyFor(provider: SupportedChatModel["provider"]): string {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "google":
      return "GOOGLE_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "deepseek":
      return "DEEPSEEK_API_KEY";
    case "mistral":
      return "MISTRAL_API_KEY";
    case "groq":
      return "GROQ_API_KEY";
    case "together":
      return "TOGETHER_API_KEY";
    default:
      return "";
  }
}

/** Build the real LanguageModel for an id from the env key of its provider. */
export function resolveBenchmarkModel(modelId: string = process.env.ANCIENT_BENCHMARK_MODEL ?? DEFAULT_CHAT_MODEL_ID): {
  model: LanguageModel;
  provider: string;
  modelId: string;
} {
  const def = findSupportedChatModel(modelId);
  if (!def) {
    throw new Error(
      `benchmark: unsupported model id '${modelId}'. Pick one from packages/shared/src/models.ts (e.g. ${DEFAULT_CHAT_MODEL_ID}) or set ANCIENT_BENCHMARK_MODEL.`,
    );
  }
  const envVar = envKeyFor(def.provider);
  const apiKey = envVar && process.env[envVar] ? process.env[envVar] : undefined;
  if (!apiKey) {
    throw new Error(
      `benchmark: model '${def.id}' (${def.provider}) needs ${envVar || "a BYOK-style provider that the harness does not support"} in the environment. ` +
        "The benchmark runs real models only — set the key (e.g. via .env) before running.",
    );
  }

  switch (def.provider) {
    case "anthropic":
      return { model: createAnthropic({ apiKey })(def.id) as unknown as LanguageModel, provider: def.provider, modelId: def.id };
    case "google":
      return { model: createGoogleGenerativeAI({ apiKey })(def.id) as unknown as LanguageModel, provider: def.provider, modelId: def.id };
    default:
      return { model: createOpenAI({ apiKey })(def.id) as unknown as LanguageModel, provider: def.provider, modelId: def.id };
  }
}