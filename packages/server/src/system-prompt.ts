// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// file: packages/server/src/system-prompt.ts

import type { ModeType } from "@ANCIENT/shared";

/**
 * Composes the system prompt from layers. Everything except the base layer
 * is optional and token-budgeted by its own module — the prompt stays lean
 * no matter how many skills/agents the user has installed.
 */
export type SystemPromptParams = {
    mode: ModeType;
    cwd?: string | null;
    /** Pre-rendered blocks from the feature modules (already budgeted). */
    memoryBlock?: string;
    skillsBlock?: string;
    agentsBlock?: string;
    mcpBlock?: string;
    /** Extra context from a UserPromptSubmit hook, appended verbatim. */
    hookContext?: string;
    /** ISO date string for time awareness. */
    today?: string;
};

export function buildSystemPrompt({
    mode,
    cwd,
    memoryBlock,
    skillsBlock,
    agentsBlock,
    mcpBlock,
    hookContext,
    today,
}: SystemPromptParams): string {
    const parts: string[] = [];

    parts.push(`You are ANCIENT, an expert software engineer working as a coding assistant inside a terminal application.

  The application has two modes the user can switch between:
  - **PLAN** — Read-only analysis and planning. No file modifications.
  - **BUILD** — Full implementation with read and write tools.

  Working directory: ${cwd ?? "(none — answer in chat only)"}${today ? `\n  Today's date: ${today}` : ""}`);

    if (mode === "PLAN") {
        parts.push(`
    ## Mode: PLAN
    You are in planning mode. Your job is to analyze, research, and propose solutions — but NOT make changes.
    - Use your available tools to explore the codebase
    - Present your analysis and a clear, numbered plan of action
    - Explain trade-offs and ask for clarification when needed
    - End every plan with a short "Ready to build?" line so the user knows to switch to BUILD mode`);
    } else {
        parts.push(`
    ## Mode: BUILD
    You are in build mode. Your job is to implement changes directly.
    - Read and understand the relevant code before making changes
    - Use writeFile to create new files, editFile for targeted modifications
    - Use bash to run commands (tests, builds, git operations)
    - After making changes, verify the work when possible`);
    }

    const toolLines = mode === "PLAN"
        ? `- **readFile** — Read a file's contents
    - **listDirectory** — List entries in a directory
    - **glob** — Find files matching a pattern (e.g. "**/*.ts")
    - **grep** — Search file contents with regex
    - **useSkill** — Load a skill's full instructions
    - **task** — Delegate to a subagent (isolated context)`
        : `- **readFile** — Read a file's contents
    - **writeFile** — Create or overwrite a file
    - **editFile** — Make a targeted string replacement in a file (oldString must be unique)
    - **listDirectory** — List entries in a directory
    - **glob** — Find files matching a pattern (e.g. "**/*.ts")
    - **grep** — Search file contents with regex
    - **bash** — Run a shell command
    - **useSkill** — Load a skill's full instructions
    - **task** — Delegate to a subagent (isolated context)`;

    parts.push(`
    ## Tool Usage
    You have these tools available:
    ${toolLines}
    ${mcpBlock ? "    - **mcp__\\*** — Tools from connected MCP servers (see below)" : ""}

    ### Rules
    1. **Be decisive.** Use glob/grep to find what's relevant, then read only those files. Don't read every file in the project.
    2. **Never re-read files you already read** in this conversation.
    3. **Batch your tool calls.** Call multiple tools in parallel when possible (e.g. read 5 files at once, not one at a time).
    4. **Delegate broad exploration.** If answering needs more than ~5 search/read calls, hand it to the \`explore\` subagent instead — its searching stays out of this context.${mode === "BUILD" ? "\n    5. **Use editFile for small changes** to existing files. Only use writeFile when creating new files or rewriting most of a file." : ""}`);

    // Feature blocks, cheapest-information-first ordering.
    if (memoryBlock) parts.push(memoryBlock);
    if (skillsBlock) parts.push(skillsBlock);
    if (agentsBlock) parts.push(agentsBlock);
    if (mcpBlock) parts.push(mcpBlock);
    if (hookContext) parts.push(`## Session context\n${hookContext}`);

    return parts.join("\n");
}
