// Destination: packages/server/src/lib/project-map.ts
//
// v2: token-budget aware. Instead of a fixed depth-3 dump, it tries deep
// first and backs off until the rendered tree fits the budget — so a small
// project gets full detail and a huge one automatically gets a shallower,
// still-useful map instead of a multi-thousand-token wall of text.

import { readdir, readFile } from "fs/promises";
import path from "path";
import { estimateTokens, truncateToTokenBudget, NOISE_DIRS } from "./token-budget";

export type ProjectMap = {
    generatedAt: number;
    tree: string;
    treeDepthUsed: number;
    packageSummaries: { path: string; name: string; description?: string }[];
};

let cached: ProjectMap | null = null;

const DEFAULT_TREE_TOKEN_BUDGET = 500;
const MAX_DESCRIPTION_CHARS = 100;

export async function getProjectMap(
    rootDir: string,
    opts?: { ttlMs?: number; treeTokenBudget?: number }
): Promise<ProjectMap> {
    const ttlMs = opts?.ttlMs ?? 10 * 60 * 1000;
    const treeTokenBudget = opts?.treeTokenBudget ?? DEFAULT_TREE_TOKEN_BUDGET;

    if (cached && Date.now() - cached.generatedAt < ttlMs) {
        return cached;
    }

    let depth = 4;
    let tree = "";
    while (depth > 0) {
        tree = await buildShallowTree(rootDir, depth);
        if (estimateTokens(tree) <= treeTokenBudget) break;
        depth--;
    }

    const packageSummaries = await collectPackageJsons(rootDir);

    cached = { generatedAt: Date.now(), tree, treeDepthUsed: depth, packageSummaries };
    return cached;
}

export function invalidateProjectMap() {
    cached = null;
}

/** Renders the project map as a system-message-ready string, hard-capped to a token budget. */
export function formatProjectMapForContext(map: ProjectMap, maxTokens = 700): string {
    const packagesList = map.packageSummaries
        .map((p) => `- ${p.path}: ${p.name}${p.description ? " — " + p.description : ""}`)
        .join("\n");

    const raw =
        `Project structure (already known — do NOT re-derive this with List Directory ` +
        `or Read File; only read specific files you need details from):\n\n` +
        `${map.tree}\n` +
        `Packages:\n${packagesList}`;

    return truncateToTokenBudget(raw, maxTokens);
}

async function buildShallowTree(dir: string, depth: number, prefix = ""): Promise<string> {
    if (depth === 0) return "";
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return "";
    }
    let out = "";
    for (const entry of entries) {
        if (NOISE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        out += `${prefix}${entry.name}\n`;
        if (entry.isDirectory()) {
            out += await buildShallowTree(path.join(dir, entry.name), depth - 1, prefix + "  ");
        }
    }
    return out;
}

async function collectPackageJsons(rootDir: string) {
    const packagesDir = path.join(rootDir, "packages");
    let dirs;
    try {
        dirs = await readdir(packagesDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const summaries: ProjectMap["packageSummaries"] = [];
    for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const pkgPath = path.join(packagesDir, d.name, "package.json");
        try {
            const raw = await readFile(pkgPath, "utf-8");
            const pkg = JSON.parse(raw);
            const description: string | undefined = pkg.description
                ? String(pkg.description).slice(0, MAX_DESCRIPTION_CHARS)
                : undefined;
            summaries.push({ path: `packages/${d.name}`, name: pkg.name ?? d.name, description });
        } catch {
            // no package.json here, or malformed — skip it
        }
    }
    return summaries;
}