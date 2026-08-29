// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Smart model routing — the cost/token-efficiency layer (infrastructure).
// Ported from the server's local model-router and promoted so the engine and
// strategies can route turns without reimplementing the heuristic.
//
// When enabled, simple prompts are answered by a configured FREE model
// (OpenRouter :free tiers, or a fully local Ollama/LM Studio/vLLM model — zero
// cost, on-device), and only complex work keeps the premium model the user
// selected. The classifier is a transparent heuristic, not magic.

import type { ModeType } from "@ANCIENT/shared";
import type { ModelRoutingSettings } from "./routing-settings";

export type RouteDecision = {
    /** "free" = resolve the configured free/local model; "selected" = keep the user's choice. */
    lane: "free" | "selected";
    reason: string;
    score: number;
};

const COMPLEX_SIGNALS = [
    "refactor", "architect", "redesign", "migrate", "migration",
    "debug", "stack trace", "race condition", "memory leak",
    "security", "vulnerability", "auth", "payment",
    "optimize", "performance", "benchmark",
    "multi-file", "across the codebase", "whole project",
    "test suite", "ci", "deploy", "production",
];

const SIMPLE_SIGNALS = [
    "rename", "typo", "comment", "format", "lint",
    "what does", "explain", "where is", "find",
    "add a log", "console.log", "small", "tiny", "quick",
];

export function classifyPrompt(content: string, mode: ModeType): number {
    const text = content.toLowerCase();
    let score = 0;

    if (content.length > 800) score += 2;
    else if (content.length > 300) score += 1;

    for (const signal of COMPLEX_SIGNALS) if (text.includes(signal)) score += 2;
    for (const signal of SIMPLE_SIGNALS) if (text.includes(signal)) score -= 1;

    // PLAN turns are exploration-heavy; keep them on the stronger model.
    if (mode === "PLAN") score += 1;

    return score;
}

/**
 * Decides which lane a turn runs in. Threshold: score >= 3 keeps the user's
 * (premium) selection; anything simpler goes free when routing is on.
 */
export function routeTurn(
    content: string,
    mode: ModeType,
    routing: ModelRoutingSettings | undefined,
): RouteDecision {
    const score = classifyPrompt(content, mode);

    if (!routing?.enabled || routing.strategy !== "free-first" || !routing.freeModel?.modelId) {
        return { lane: "selected", reason: "routing disabled or no free model configured", score };
    }
    if (score >= 3) {
        return { lane: "selected", reason: "complex task — staying on the selected model", score };
    }
    return { lane: "free", reason: "simple task — routed to the free/local model", score };
}
