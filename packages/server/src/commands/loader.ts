// file: packages/server/src/commands/loader.ts
// Slash commands — markdown prompt templates in `.ancient/commands/` (project)
// and `~/.ancient/commands/` (user), expanded server-side before the model
// ever sees them. `/review src/auth.ts` becomes the full review prompt with
// $ARGUMENTS substituted.
//
// UI-level commands (/models, /theme, /sessions, /compact, /rewind, …) are
// handled by the CLI command palette, not here — see
// cli/src/components/command-menu/commands.tsx.

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { parseFrontmatter } from "../lib/frontmatter";
import { commandDirs } from "../lib/workspace";

export type SlashCommand = {
    name: string;
    description: string;
    /** Prompt template. `$ARGUMENTS` is replaced by the text after the command. */
    template: string;
    source: "global" | "project" | "builtin";
};

const MAX_TEMPLATE_CHARS = 8_000;

/** Built-in prompt commands — always available, shadowable by user files. */
const BUILTIN_COMMANDS: SlashCommand[] = [
    {
        name: "review",
        description: "Review the given files (or latest changes) for bugs and style issues",
        template: `Review the following for correctness bugs, edge cases, security issues, and consistency with the codebase's conventions. Report findings ordered by severity with file:line references and concrete fixes. Target: $ARGUMENTS

If the target is empty, review the most recent uncommitted changes (use bash: git diff).`,
        source: "builtin",
    },
    {
        name: "explain",
        description: "Explain how a file, function, or feature works",
        template: `Explain how the following works, for an engineer who is new to this codebase. Trace the important call paths, name the key files, and keep it concise: $ARGUMENTS`,
        source: "builtin",
    },
    {
        name: "test",
        description: "Write tests for a file or feature",
        template: `Write tests for: $ARGUMENTS

First find the project's test framework and read 1-2 existing tests to match conventions exactly. Then write the tests and run them with bash to confirm they pass.`,
        source: "builtin",
    },
    {
        name: "fix",
        description: "Diagnose and fix a bug described in the arguments",
        template: `Diagnose and fix the following issue. Start by reproducing or locating the root cause with evidence (logs, tests, code reads) before editing anything: $ARGUMENTS`,
        source: "builtin",
    },
    {
        name: "commit",
        description: "Stage and commit current changes with a conventional-commit message",
        template: `Create a git commit for the current changes. Run git status and git diff to see what changed, stage the relevant files, and write a concise conventional-commit message (type(scope): summary). Do not push. Extra instructions: $ARGUMENTS`,
        source: "builtin",
    },
];

async function readCommandFile(path: string, source: "global" | "project"): Promise<SlashCommand | null> {
    try {
        const raw = await readFile(path, "utf-8");
        const { data, body } = parseFrontmatter(raw);
        if (!body) return null;
        const name = data.name?.trim() || path.split(/[\\/]/).pop()!.replace(/\.md$/i, "");
        return {
            name,
            description: (data.description ?? "").trim().slice(0, 200),
            template: body.length > MAX_TEMPLATE_CHARS ? body.slice(0, MAX_TEMPLATE_CHARS) : body,
            source,
        };
    } catch {
        return null;
    }
}

/** All commands: built-ins, then global, then project (later shadows earlier). */
export async function listCommands(cwd: string | null): Promise<SlashCommand[]> {
    const byName = new Map<string, SlashCommand>();
    for (const cmd of BUILTIN_COMMANDS) byName.set(cmd.name, cmd);

    for (const root of commandDirs(cwd)) {
        const source = cwd && root.startsWith(cwd) ? "project" as const : "global" as const;
        let entries: string[];
        try {
            entries = await readdir(root);
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.toLowerCase().endsWith(".md")) continue;
            const cmd = await readCommandFile(join(root, entry), source);
            if (cmd) byName.set(cmd.name, cmd);
        }
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type CommandExpansion =
    | { kind: "not-a-command" }
    | { kind: "expanded"; name: string; content: string }
    | { kind: "unknown"; name: string }
    | { kind: "ui-command"; name: string };

/** Commands the CLI palette owns — typing them in chat gets a helpful error. */
const UI_COMMANDS = new Set([
    "new", "models", "sessions", "theme", "login", "logout", "exit",
    "agents", "skills", "compact", "rewind", "mcp",
]);

/**
 * Expands a leading `/name args...` into a full prompt. Non-command input
 * passes through untouched.
 */
export async function expandSlashCommand(content: string, cwd: string | null): Promise<CommandExpansion> {
    const m = content.match(/^\/([A-Za-z0-9_-]+)\s*([\s\S]*)$/);
    if (!m) return { kind: "not-a-command" };

    const name = m[1]!;
    const args = (m[2] ?? "").trim();

    if (UI_COMMANDS.has(name)) return { kind: "ui-command", name };

    const commands = await listCommands(cwd);
    const cmd = commands.find((c) => c.name === name);
    if (!cmd) return { kind: "unknown", name };

    const expandedBody = cmd.template.replaceAll("$ARGUMENTS", args || "(no arguments given)");
    return {
        kind: "expanded",
        name,
        // Keep the invocation visible so history shows what the user ran.
        content: `[/${name}${args ? ` ${args}` : ""}]\n\n${expandedBody}`,
    };
}
