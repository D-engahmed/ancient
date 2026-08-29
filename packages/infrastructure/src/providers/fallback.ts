// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Fallback selection for graceful rate-limit downgrades (infrastructure).
// Ported from the server's local fallback module and made type-agnostic so any
// layer can build a candidate from its own resolved-model shape.

import { modelKey, checkCooldown } from "./breaker";

/** A candidate model a caller might fall back to when the primary is on
 * cooldown/failed. `key` is the same stable breaker key derived from provider
 * + modelId. `resolved` is opaque here so this module never couples to the
 * AI-SDK's LanguageModel type. */
export type FallbackCandidate<TResolved> = {
    key: string;
    resolved: TResolved;
    isFree: boolean;
};

/** Build a FallbackCandidate for a resolved model, deriving the breaker key. */
export function asFallbackCandidate<TResolved>(
    provider: string,
    modelId: string,
    resolved: TResolved,
    isFree: boolean,
): FallbackCandidate<TResolved> {
    return { key: modelKey(provider, modelId), resolved, isFree };
}

/**
 * Decide which already-resolved model to adopt as a graceful rate-limit
 * fallback for a turn, purely from a candidate list. Rules:
 *   - never pick the primary model itself (same breaker key) — that would
 *     retry the exact call that got rate-limited;
 *   - never pick a candidate currently on cooldown — that would produce a
 *     second, equally-confusing failure instead of a working reply;
 *   - otherwise return the first healthy candidate (callers supply them in
 *     priority order: configured free model, then a builtin default).
 *
 * Returns null when no candidate is healthy, in which case the caller keeps the
 * normal cooldown error so the user's explicit model choice is respected rather
 * than silently swapped for a model we know is also unavailable.
 */
export function pickHealthyFallback<TResolved>(
    candidates: FallbackCandidate<TResolved>[],
    primaryKey: string,
): FallbackCandidate<TResolved> | null {
    for (const candidate of candidates) {
        if (candidate.key === primaryKey) continue;
        if (checkCooldown(candidate.key).onCooldown) continue;
        return candidate;
    }
    return null;
}
