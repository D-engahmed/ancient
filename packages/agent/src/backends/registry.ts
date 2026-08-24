/**
 * Backend Registry
 * 
 * Maintains a catalog of available models and their capabilities.
 */

import type { ModelInfo, BackendConfig } from "../types";

export class BackendRegistry {
    private models = new Map<string, ModelInfo>();

    constructor() {
        this.registerDefaults();
    }

    register(model: ModelInfo): void {
        this.models.set(model.id, model);
    }

    get(modelId: string): ModelInfo | undefined {
        return this.models.get(modelId);
    }

    list(provider?: string): ModelInfo[] {
        const all = Array.from(this.models.values());
        return provider ? all.filter(m => m.provider === provider) : all;
    }

    findByCapability(capability: string): ModelInfo[] {
        return Array.from(this.models.values()).filter(m =>
            m.capabilities.includes(capability)
        );
    }

    getCheapestModel(minTier: ModelInfo["tier"] = "free"): ModelInfo | undefined {
        const tiers = { free: 0, cheap: 1, standard: 2, premium: 3 };
        const minTierValue = tiers[minTier];

        return Array.from(this.models.values())
            .filter(m => tiers[m.tier] >= minTierValue)
            .sort((a, b) => a.pricing.inputPer1k - b.pricing.inputPer1k)[0];
    }

    private registerDefaults(): void {
        this.register({
            id: "gpt-4o",
            provider: "openai",
            contextWindow: 128000,
            maxOutputTokens: 4096,
            supportsTools: true,
            supportsVision: true,
            supportsStreaming: true,
            pricing: { inputPer1k: 0.005, outputPer1k: 0.015 },
            capabilities: ["code", "vision", "tools", "reasoning"],
            tier: "premium",
        });

        this.register({
            id: "gpt-4o-mini",
            provider: "openai",
            contextWindow: 128000,
            maxOutputTokens: 4096,
            supportsTools: true,
            supportsVision: true,
            supportsStreaming: true,
            pricing: { inputPer1k: 0.00015, outputPer1k: 0.0006 },
            capabilities: ["code", "vision", "tools"],
            tier: "cheap",
        });

        this.register({
            id: "claude-3-5-sonnet-20241022",
            provider: "anthropic",
            contextWindow: 200000,
            maxOutputTokens: 8192,
            supportsTools: true,
            supportsVision: true,
            supportsStreaming: true,
            pricing: { inputPer1k: 0.003, outputPer1k: 0.015 },
            capabilities: ["code", "vision", "tools", "reasoning"],
            tier: "premium",
        });

        this.register({
            id: "mistralai/devstral-2512:free",
            provider: "openrouter",
            contextWindow: 128000,
            maxOutputTokens: 4096,
            supportsTools: true,
            supportsVision: false,
            supportsStreaming: true,
            pricing: { inputPer1k: 0, outputPer1k: 0 },
            capabilities: ["code", "tools"],
            tier: "free",
        });
    }
}

export const defaultRegistry = new BackendRegistry();