// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Cost accounting for provider usage (infrastructure).
//
// Pure functions over the shared model-pricing catalog ({@link SUPPORTED_CHAT_MODELS}).
// Any layer that reports or budgets model spend (gateway usage endpoints, engine
// observability, strategies) uses these, so cost math lives in exactly one place.

import { findSupportedChatModel } from "@ANCIENT/shared";

export type CostEstimate = {
    modelId: string;
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
};

export type UsageTokens = {
    inputTokens: number;
    outputTokens: number;
};

export type CostBreakdown = {
    modelId: string;
    /** Known pricing for this model id, or undefined when not in the catalog. */
    pricing: CostEstimate | undefined;
    inputUsd: number;
    outputUsd: number;
    /** inputUsd + outputUsd (0 when pricing is unknown). */
    totalUsd: number;
};

/** Look up unit pricing for a known model id. Returns undefined for ids not in
 * the catalog (local models, custom ids, or newly-added ids) — never throws. */
export function pricingFor(modelId: string): CostEstimate | undefined {
    const model = findSupportedChatModel(modelId);
    if (!model) return undefined;
    return {
        modelId,
        inputUsdPerMillionTokens: model.pricing.inputUsdPerMillionTokens,
        outputUsdPerMillionTokens: model.pricing.outputUsdPerMillionTokens,
    };
}

/**
 * Compute a US-dollar cost breakdown for a usage record. Unknown pricing
 * yields 0 (callers should not assume a model is free based on a zero here —
 * prefer checking `pricing === undefined`).
 */
export function costFor(modelId: string, usage: UsageTokens): CostBreakdown {
    const pricing = pricingFor(modelId);
    if (!pricing) {
        return {
            modelId,
            pricing: undefined,
            inputUsd: 0,
            outputUsd: 0,
            totalUsd: 0,
        };
    }
    const inputUsd =
        (usage.inputTokens / 1_000_000) * pricing.inputUsdPerMillionTokens;
    const outputUsd =
        (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens;
    return {
        modelId,
        pricing,
        inputUsd,
        outputUsd,
        totalUsd: inputUsd + outputUsd,
    };
}

/** Sum a list of breakdowns into a single total (for per-execution rollups). */
export function sumCosts(breakdowns: CostBreakdown[]): {
    inputUsd: number;
    outputUsd: number;
    totalUsd: number;
} {
    return breakdowns.reduce(
        (acc, b) => ({
            inputUsd: acc.inputUsd + b.inputUsd,
            outputUsd: acc.outputUsd + b.outputUsd,
            totalUsd: acc.totalUsd + b.totalUsd,
        }),
        { inputUsd: 0, outputUsd: 0, totalUsd: 0 },
    );
}
