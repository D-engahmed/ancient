// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Memory types + budgets (infrastructure). A memory file is the ANCIENT.md
// convention (the CLAUDE.md equivalent) loaded into the system prompt so the
// agent always knows project conventions, commands, and constraints.

export type MemoryScope = "user" | "project" | "ancestor";

export type MemoryFile = {
    path: string;
    scope: MemoryScope;
    content: string;
};

/** Tunable limits so memory stays cheap and deterministic. */
export type MemoryBudget = {
    /** Per memory file, after @import expansion. */
    maxFileChars: number;
    /** Across all files combined, after discovery. */
    maxTotalChars: number;
};

export const DEFAULT_MEMORY_BUDGET: MemoryBudget = {
    maxFileChars: 6_000,
    maxTotalChars: 16_000,
};

/** Options for {@link loadMemory}. `cwd` nullable means no project/ancestor
 * discovery (global-only); `homedir` is injectable for tests. */
export type MemoryOptions = {
    cwd: string | null;
    homedir?: string;
    filename?: string;
    budget?: Partial<MemoryBudget>;
};
