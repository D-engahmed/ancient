// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { modelKey, checkCooldown } from "./rate-limit-breaker";
import { resolveFreeModel, resolveBuiltinFallbackModel, type ResolvedModel } from "./models";
import type { AncientSettings } from "../hooks/settings";

export type FallbackCandidate = {
    key: string;
    resolved: ResolvedModel;
    isFree: boolean;
};

/**
 * Decides which already-resolved model to adopt as a graceful rate-limit
 * fallback for a turn, purely from a candidate list. Rules:
 *   - never pick the primary model itself (same rlKey) — that would just
 *     retry the exact call that got rate-limited;
 *   - never pick a candidate currently on cooldown — that would produce a
 *     second, equally-confusing failure instead of a working reply;
 *   - otherwise return the first healthy candidate (callers supply them in
 *     priority order: configured free model, then the builtin default).
 *
 * Returns null when no candidate is healthy, in which case the caller keeps
 * the normal cooldown error so the user's explicit model choice is respected
 * rather than silently swapped for a model we know is also unavailable.
 */
export function pickHealthyFallback(
    candidates: FallbackCandidate[],
    primaryRlKey: string,
): FallbackCandidate | null {
    for (const candidate of candidates) {
        if (candidate.key === primaryRlKey) continue;
        if (checkCooldown(candidate.key).onCooldown) continue;
        return candidate;
    }
    return null;
}

/**
 * Builds a FallbackCandidate from a ResolvedModel, deriving the same rlKey
 * the rate-limit breaker uses for cooldown tracking.
 */
export function asFallbackCandidate(resolved: ResolvedModel, isFree: boolean): FallbackCandidate {
    return { key: modelKey(resolved.provider, resolved.modelId), resolved, isFree };
}

export type HealthyFallbackDecision = { resolved: ResolvedModel; isFree: boolean } | null;

/**
 * Bounded graceful fallback when the selected model is rate-limited.
 * Returns a healthy alternative (never the primary itself, never one currently
 * on cooldown) in priority order: the configured freeModel, then the builtin
 * default. Returns null when no candidate is resolvable/healthy — in that case
 * the caller surfaces the normal cooldown error so the user's explicit model
 * choice is still respected (Rule of least surprise: never silently replace a
 * model with one we know is also rate-limited, which would just produce a
 * second, equally confusing failure).
 *
 * Shared by the chat stream and the execution hub so both surfaces follow the
 * same cooldown/fallback policy.
 */
export function selectHealthyFallbackModel(
    settings: AncientSettings,
    primaryRlKey: string,
): HealthyFallbackDecision {
    const candidates: Array<{ resolved: ResolvedModel; isFree: boolean }> = [];

    const free = resolveFreeModel(settings.modelRouting?.freeModel);
    if (free) candidates.push({ resolved: free, isFree: true });

    const builtin = resolveBuiltinFallbackModel();
    if (builtin) candidates.push({ resolved: builtin, isFree: false });

    const picked = pickHealthyFallback(
        candidates.map((c) => asFallbackCandidate(c.resolved, c.isFree)),
        primaryRlKey,
    );
    return picked ? { resolved: picked.resolved, isFree: picked.isFree } : null;
}
