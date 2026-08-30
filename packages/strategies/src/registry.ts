// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Strategy catalog + selector wrapper (strategies). Wired leaves (direct,
// agent-loop, subagents) are the runnable set; teams/arena are catalogued so
// the ladder and selector are complete, but `wired:false` keeps the selector
// from ever picking them until the engine runtime lands (A-STRAT-001).

import { agentLoopStrategy } from "./agent-loop";
import { directStrategy } from "./direct";
import { selectStrategy } from "./selector";
import { subagentsStrategy } from "./subagents";
import { EMPTY_USAGE } from "./util";
import { makeError } from "@ANCIENT/contracts";
import type { ExecutionStrategy, StrategyId, StrategyRung, StrategySelection, TaskProfile } from "./types";

/** A catalogued-but-unwired strategy: never selectable, never throws. */
function unwired(id: "teams" | "arena", rung: StrategyRung): ExecutionStrategy {
    return {
        id,
        rung,
        wired: false,
        match: () => null,
        async *execute() {
            yield {
                type: "error",
                error: makeError({
                    code: "STRATEGY_UNRECOVERABLE",
                    domain: "strategy",
                    message: `strategy '${id}' is not wired yet (requires the engine runtime)`,
                }),
            } as const;
            yield { type: "done", turnCount: 0, toolCount: 0, usage: EMPTY_USAGE() } as const;
        },
    };
}

/** Complete ladder: three wired leaves + two catalogued placeholders. */
export const strategyCatalog: readonly ExecutionStrategy[] = [
    directStrategy,
    agentLoopStrategy,
    subagentsStrategy,
    unwired("teams", 3),
    unwired("arena", 4),
];

export const wiredStrategies: readonly ExecutionStrategy[] = strategyCatalog.filter((s) => s.wired);

export class StrategySelector {
    constructor(private readonly catalog: readonly ExecutionStrategy[] = strategyCatalog) {}

    select(profile: TaskProfile): StrategySelection {
        return selectStrategy(profile, this.catalog);
    }

    listWired(): readonly ExecutionStrategy[] {
        return this.catalog.filter((s) => s.wired);
    }

    has(id: StrategyId): boolean {
        return this.catalog.some((s) => s.id === id);
    }
}