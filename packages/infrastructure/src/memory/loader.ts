// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Memory discovery + prompt-block building (infrastructure).
// Ported from the server's local memory/loader and made portable (homedir and
// budget injectable) so the layer is unit-testable and reusable by any layer
// that needs standing project conventions in the system prompt.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir as osHomedir } from "node:os";
import type { MemoryFile, MemoryOptions } from "./types";
import { DEFAULT_MEMORY_BUDGET } from "./types";

const MEMORY_FILENAME = "ANCIENT.md";

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

async function readMemoryFile(
    path: string,
    scope: MemoryFile["scope"],
    budget: { maxFileChars: number },
): Promise<MemoryFile | null> {
    try {
        const raw = await readFile(path, "utf-8");
        const expanded = await resolveImports(raw, path, 0);
        return {
            path,
            scope,
            content: expanded.length > budget.maxFileChars
                ? expanded.slice(0, budget.maxFileChars) + "\n... (memory file truncated)"
                : expanded,
        };
    } catch {
        return null;
    }
}

/**
 * Discovers memory files for a workspace:
 *   1. <homedir>/.ancient/ANCIENT.md       (user-global memory)
 *   2. ANCIENT.md in each ancestor dir      (monorepo root conventions)
 *   3. <cwd>/ANCIENT.md                     (project memory — highest precedence)
 */
export async function loadMemory(options: MemoryOptions): Promise<MemoryFile[]> {
    const home = options.homedir ?? osHomedir();
    const filename = options.filename ?? MEMORY_FILENAME;
    const budget = {
        maxFileChars: options.budget?.maxFileChars ?? DEFAULT_MEMORY_BUDGET.maxFileChars,
        maxTotalChars: options.budget?.maxTotalChars ?? DEFAULT_MEMORY_BUDGET.maxTotalChars,
    };
    const files: MemoryFile[] = [];

    const globalFile = join(home, ".ancient", filename);
    if (existsSync(globalFile)) {
        const f = await readMemoryFile(globalFile, "user", budget);
        if (f) files.push(f);
    }

    if (options.cwd) {
        const chain: string[] = [];
        let dir = resolve(options.cwd);
        while (true) {
            const candidate = join(dir, filename);
            if (existsSync(candidate)) chain.push(candidate);
            if (dir === home) break;
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
        // root-most first so closer (more specific) files come last
        for (const path of chain.reverse()) {
            const scope: MemoryFile["scope"] =
                path === join(resolve(options.cwd), filename) ? "project" : "ancestor";
            const f = await readMemoryFile(path, scope, budget);
            if (f) files.push(f);
        }
    }

    // Enforce the global budget, dropping from the front (least specific).
    let total = files.reduce((n, f) => n + f.content.length, 0);
    while (total > budget.maxTotalChars && files.length > 1) {
        total -= files.shift()!.content.length;
    }
    return files;
}

export function buildMemoryPromptBlock(files: MemoryFile[]): string {
    if (files.length === 0) return "";
    const sections = files.map(
        (f) =>
            `### ${f.scope === "user" ? "User memory" : f.scope === "project" ? "Project memory" : "Parent directory memory"} (${f.path})\n${f.content}`,
    );
    return [
        "## Memory",
        "The following memory files were loaded automatically. Treat them as standing instructions from the user — conventions, commands, and constraints that apply to every task in this workspace.",
        ...sections,
    ].join("\n\n");
}
