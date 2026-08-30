// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Layer 19 — Model & Provider Harness contract. Model access is a contract,
// not a vendor SDK call; a provider is a plugin, not a special case.
// `ModelProviderPlugin` is the single surface the engine ever imports for a
// model (incl. BYOK / free-tier / local / OpenAI-compatible plugins).

/** Model abilities (Layer 19). */
export type ModelCapability =
  | "text"
  | "vision"
  | "tool-use"
  | "reasoning"
  | "embeddings";

/** How a plugin authenticates with its upstream. */
export type AuthMode = "api-key" | "oauth" | "local" | "none";

/** One model the plugin can serve. */
export interface ModelDescriptor {
  providerId: string;
  modelId: string;
  contextWindow: number;
  capabilities: ModelCapability[];
  pricing?: { input: number; output: number };
}

/** Runtime health probe result (used by the circuit-breaker/fallback chain). */
export interface ProviderHealth {
  healthy: boolean;
  latencyMs?: number;
}

/** The unified provider plugin contract (Layer 19). */
export interface ModelProviderPlugin {
  id: string;
  capabilities: ModelCapability[];
  auth: AuthMode;
  listModels(): Promise<ModelDescriptor[]>;
  complete(req: CompletionRequest): AsyncIterable<CompletionEvent>;
  costModel?: import("./capability").CostModel;
  healthCheck(): Promise<ProviderHealth>;
}

/** Provider-neutral completion request (canonical, never vendor format). */
export interface CompletionRequest {
  model: string;
  messages: CanonicalMessage[];
  tools?: unknown[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** Canonical, provider-neutral message (Layer 19 session portability). */
export type CanonicalMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: unknown[] };

/** Streamed completion events (token deltas + final metadata). */
export type CompletionEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; call: unknown }
  | { type: "finish"; usage?: unknown };

/** Model policy — how a model actually gets picked (Layer 19). */
export interface ModelPolicy {
  requiredCapabilities: ModelCapability[];
  /** e.g. the user's own key first, if present. */
  preferredProviders?: string[];
  /** Cost ceiling: never exceed (per model call). */
  costCeiling?: number;
  /** Latency ceiling: never exceed. */
  latencyCeiling?: number;
  /** Ordered provider/model fallback chain (Layer 19). */
  fallbackChain: string[];
}