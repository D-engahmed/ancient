// file: packages/server/src/memory/loader.ts
// Memory files — ANCIENT.md, the project/user memory convention (the
// CLAUDE.md equivalent). Loaded automatically into the system prompt so the
// agent always knows project conventions, commands, and constraints.

import { readFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { existsSync } from "fs";
import { homedir } from "os";

const MAX_FILE_CHARS = 6_000;   // per memory file — memory must stay cheap
const MAX_TOTAL_CHARS = 16_000; // across all memory files
const MEMORY_FILENAME = "ANCIENT.md";

export type MemoryFile = {
    path: string;
    scope: "user" | "project" | "ancestor";
    content: string;
};

/** Resolves one level of `@path/to/file.md` imports inside a memory file. */
async function resolveImports(content: string, filePath: string, depth: number): Promise<string> {
    if (depth > 1) return content;
    const lines = content.split("\n");
    const out: string[] = [];
    for (const line of lines) {
        const m = line.match(/^@(\S+)\s*$/);
        if (!m) {
            out.push(line);
            continue;
        }
        const importPath = resolve(dirname(filePath), m[1]!);
        try {
            const imported = await readFile(importPath, "utf-8");
            out.push(`<!-- imported from ${m[1]} -->`);
            out.push(await resolveImports(imported, importPath, depth + 1));
        } catch {
            out.push(`<!-- import not found: ${m[1]} -->`);
        }
    }
    return out.join("\n");
}

async function readMemoryFile(path: string, scope: MemoryFile["scope"]): Promise<MemoryFile | null> {
    try {
        const raw = await readFile(path, "utf-8");
        const expanded = await resolveImports(raw, path, 0);
        return {
            path,
            scope,
            content: expanded.length > MAX_FILE_CHARS
                ? expanded.slice(0, MAX_FILE_CHARS) + "\n... (memory file truncated)"
                : expanded,
        };
    } catch {
        return null;
    }
}

/**
 * Discovers memory files for a workspace:
 *   1. ~/.ancient/ANCIENT.md            (user-global memory)
 *   2. ANCIENT.md in each ancestor dir   (monorepo root conventions)
 *   3. <cwd>/ANCIENT.md                  (project memory — highest precedence)
 */
export async function loadMemory(cwd: string | null): Promise<MemoryFile[]> {
    const files: MemoryFile[] = [];

    const globalFile = join(homedir(), ".ancient", MEMORY_FILENAME);
    if (existsSync(globalFile)) {
        const f = await readMemoryFile(globalFile, "user");
        if (f) files.push(f);
    }

    if (cwd) {
        const home = homedir();
        const chain: string[] = [];
        let dir = resolve(cwd);
        while (true) {
            const candidate = join(dir, MEMORY_FILENAME);
            if (existsSync(candidate)) chain.push(candidate);
            if (dir === home) break;
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
        // root-most first so closer (more specific) files come last
        for (const path of chain.reverse()) {
            const scope: MemoryFile["scope"] = path === join(resolve(cwd), MEMORY_FILENAME) ? "project" : "ancestor";
            const f = await readMemoryFile(path, scope);
            if (f) files.push(f);
        }
    }

    // Enforce the global budget, dropping from the front (least specific).
    let total = files.reduce((n, f) => n + f.content.length, 0);
    while (total > MAX_TOTAL_CHARS && files.length > 1) {
        total -= files.shift()!.content.length;
    }
    return files;
}

export function buildMemoryPromptBlock(files: MemoryFile[]): string {
    if (files.length === 0) return "";
    const sections = files.map(
        (f) => `### ${f.scope === "user" ? "User memory" : f.scope === "project" ? "Project memory" : "Parent directory memory"} (${f.path})\n${f.content}`,
    );
    return [
        "## Memory",
        "The following memory files were loaded automatically. Treat them as standing instructions from the user — conventions, commands, and constraints that apply to every task in this workspace.",
        ...sections,
    ].join("\n\n");
}
