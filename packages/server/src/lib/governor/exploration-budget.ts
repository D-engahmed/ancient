// Destination: packages/server/src/lib/governor/exploration-budget.ts
//
// Blocks duplicate Read File / List Directory calls and hard-caps read-only
// exploration per turn. Now also caps the size of what a single file read
// returns (via truncateFileContent) — a 3000-line seed.ts or schema file
// shouldn't cost 3000 lines of input tokens just to confirm a table name.

import { truncateFileContent } from "../token-budget";

type WithPath = { path: string };
type Execute<Args> = (args: Args) => Promise<string>;

export function createExplorationGuard(budget = 8, readTokenBudget = 1500) {
    const filesRead = new Set<string>();
    const dirsListed = new Set<string>();
    let readOnlyCallCount = 0;

    function budgetExceededMessage(toolName: string): string {
        return (
            `[${toolName} blocked] You've used your exploration budget (${budget} ` +
            `read-only calls this turn). Stop exploring and act on what you already ` +
            `know. If you genuinely cannot proceed, say so explicitly and name the ` +
            `specific thing you need — don't keep listing or reading files.`
        );
    }

    return {
        get callCount() {
            return readOnlyCallCount;
        },

        guardRead<Args extends WithPath>(execute: Execute<Args>): Execute<Args> {
            return async (args) => {
                if (filesRead.has(args.path)) {
                    return (
                        `[Read File blocked] You already read ${args.path} earlier this ` +
                        `turn. Use what you already have from it instead of reading it again.`
                    );
                }
                if (readOnlyCallCount >= budget) {
                    return budgetExceededMessage("Read File");
                }
                filesRead.add(args.path);
                readOnlyCallCount++;
                const result = await execute(args);
                return truncateFileContent(result, args.path, readTokenBudget);
            };
        },

        guardList<Args extends WithPath>(execute: Execute<Args>): Execute<Args> {
            return async (args) => {
                if (dirsListed.has(args.path)) {
                    return `[List Directory blocked] You already listed ${args.path}. Don't list it again.`;
                }
                if (readOnlyCallCount >= budget) {
                    return budgetExceededMessage("List Directory");
                }
                dirsListed.add(args.path);
                readOnlyCallCount++;
                return execute(args);
            };
        },
    };
}