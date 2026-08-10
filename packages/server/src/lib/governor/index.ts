// Destination: packages/server/src/lib/governor/index.ts
//
// Single entry point. One senior-engineer persona (behavioral framing,
// injected into the system prompt as text) backed by two things that are
// actually enforced in code rather than just requested — an exploration
// budget and a scoping guard. Text asks; code enforces. Use both.

import { readFileSync } from "fs";
import path from "path";
import { createExplorationGuard } from "./exploration-budget";
import { createScopingGuard } from "./scoping-guard";

const RULES_DIR = path.join(__dirname, "rules");
let cachedAddendum: string | null = null;

function loadSystemPromptAddendum(): string {
    if (cachedAddendum) return cachedAddendum;
    const persona = readFileSync(path.join(RULES_DIR, "persona.md"), "utf-8");
    const scoping = readFileSync(path.join(RULES_DIR, "scoping-rules.md"), "utf-8");
    cachedAddendum = `${persona}\n\n${scoping}`;
    return cachedAddendum;
}

export function createGovernor(opts?: {
    explorationBudget?: number;
    readTokenBudget?: number;
}) {
    const exploration = createExplorationGuard(
        opts?.explorationBudget ?? 8,
        opts?.readTokenBudget ?? 1500
    );
    const scoping = createScopingGuard();

    return {
        guardRead: exploration.guardRead,
        guardList: exploration.guardList,

        guardWrite<Args extends { path: string }>(
            execute: (args: Args) => Promise<string>
        ): (args: Args) => Promise<string> {
            return async (args) => {
                const blocked = scoping.checkScope(args.path);
                if (blocked) return blocked;
                return execute(args);
            };
        },

        get explorationCallCount() {
            return exploration.callCount;
        },
        get touchedPaths() {
            return scoping.touchedPaths();
        },

        /** Append this to your existing system prompt content — don't replace it. */
        systemPromptAddendum: loadSystemPromptAddendum(),
    };
}