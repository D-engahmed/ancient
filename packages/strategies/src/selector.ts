// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Strategy selector (strategies) — the R3 decision the engine calls
// (ARCHITECTURE.md §4, §5; A-STRAT-001).
//
// Pure + deterministic: given a TaskProfile and the strategy catalog, choose
// the cheapest reliable wired strategy for the task. Never selects an unwired
// strategy; honors an explicit preferredStrategy; falls back to the lowest
// wired rung when nothing matches.

import type { ComplexityTier, ExecutionStrategy, StrategyId, StrategyRung, TaskProfile } from "./types";

const TOKEN_BUMP_RUNG_ABOVE = 60_000;

const TIER_ORDER: readonly ComplexityTier[] = ["trivial", "simple", "moderate", "complex", "very-complex"];

/** Upper complexity a strategy's rung is comfortable forcing via preference. */
export const RUNG_CEILING: Record<StrategyRung, ComplexityTier> = {
    0: "simple",
    1: "moderate",
    2: "complex",
    3: "very-complex",
    4: "very-complex",
};

/** Preferred-strategy fit: explicit preference is honored up to its ceiling. */
function acceptsAsPreferred(strategy: ExecutionStrategy, profile: TaskProfile): boolean {
    if (strategy.match(profile)) return true;
    const ceiling = TIER_ORDER.indexOf(RUNG_CEILING[strategy.rung]);
    const tier = TIER_ORDER.indexOf(profile.complexity ?? "simple");
    return tier <= ceiling;
}

/** Maps complexity to the ladder rung it deserves. */
export function wantedRung(profile: TaskProfile): StrategyRung {
    const tier = profile.complexity;
    let rung: StrategyRung;
    if (tier === "trivial" || tier === "simple") rung = 0;
    else if (tier === "moderate") rung = 1;
    else if (tier === "complex" || profile.parallelizable) rung = 2;
    else rung = 3; // very-complex

    if ((profile.estimatedTokens ?? 0) > TOKEN_BUMP_RUNG_ABOVE && rung > 0) rung = Math.min(4, rung + 1) as StrategyRung;
    if (profile.parallelizable && rung < 2) rung = 2;
    return rung;
}

export function selectStrategy(
    profile: TaskProfile,
    catalog: readonly ExecutionStrategy[],
    options?: { minRung?: StrategyRung },
): { id: StrategyId; rung: StrategyRung; reason: string } {
    const floor = options?.minRung ?? 0;
    const byId = new Map(catalog.map((s) => [s.id, s]));
    // "At least this rung" guard (used by the engine's bounded re-selection):
    // a strategy a full rung *below* the escalation floor must never win, even
    // if it also happens to match the profile.
    const atLeast = (s: ExecutionStrategy): boolean => s.rung >= floor;

    // 1. Explicit preference wins — unless it is not wired, below the rung
    //    floor, or the profile is beyond the strategy's ceiling (e.g. forcing
    //    `direct` onto heavy work).
    if (profile.preferredStrategy) {
        const preferred = byId.get(profile.preferredStrategy);
        if (preferred && preferred.wired && atLeast(preferred) && acceptsAsPreferred(preferred, profile)) {
            return { id: preferred.id, rung: preferred.rung, reason: `preferred ${preferred.id}` };
        }
        const fallback = cheapestWiredAtOrAbove(catalog, floor) ?? cheapestWired(catalog);
        return {
            id: fallback.id,
            rung: fallback.rung,
            reason: `preferred ${profile.preferredStrategy} unavailable (unwired/unfit); fell back to cheapest wired ${fallback.id}`,
        };
    }

    // 2. Lowest wired rung that accepts the profile (complexity must be earned).
    const wanted = wantedRung(profile);
    const accepting = catalog.filter((s) => s.wired && atLeast(s) && s.match(profile));
    if (accepting.length > 0) {
        const best = [...accepting].sort((a, b) => a.rung - b.rung)[0]!;
        const over = best.rung > wanted;
        return {
            id: best.id,
            rung: best.rung,
            reason: over
                ? `${best.id}@r${best.rung} — no wired strategy below rung ${wanted} fits`
                : `${best.id}@r${best.rung} — cheapest wired fit for complexity '${profile.complexity ?? "inferred"}'`,
        };
    }

    // 3. Nothing matches — cheapest wired strategy at or above the floor as a
    //    safety ceiling (falling back below the floor means the engine will
    //    detect no escalation happened and settle honestly).
    const fallback = cheapestWiredAtOrAbove(catalog, floor) ?? cheapestWired(catalog);
    return {
        id: fallback.id,
        rung: fallback.rung,
        reason: `no explicit fit; fell back to cheapest wired ${fallback.id}`,
    };
}

export function cheapestWired(catalog: readonly ExecutionStrategy[]): ExecutionStrategy {
    const wired = catalog.filter((s) => s.wired);
    if (wired.length === 0) throw new Error("strategy catalog has no wired strategies");
    return wired.sort((a, b) => a.rung - b.rung)[0]!;
}

/** Cheapest wired strategy at or above the rung floor; undefined when none. */
function cheapestWiredAtOrAbove(catalog: readonly ExecutionStrategy[], floor: StrategyRung): ExecutionStrategy | undefined {
    const wired = catalog.filter((s) => s.wired && s.rung >= floor);
    if (wired.length === 0) return undefined;
    return wired.sort((a, b) => a.rung - b.rung)[0]!;
}