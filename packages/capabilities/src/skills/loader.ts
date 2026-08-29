// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Skills system (capabilities/skills) — Claude-Code-style SKILL.md packages
// with progressive disclosure. Only name + description ever enter a prompt;
// the full skill body is pulled in on demand via the `useSkill` tool. Keeps
// the standing token cost of a large skill library near zero.
//
// Roots: per-user `~/.ancient/skills` and per-project `<cwd>/.ancient/skills`
// (project shadows global on a name collision). Same convention as the server
// (packages/server/src/lib/workspace.ts), here self-contained so the
// capability layer has no server dependency (A-LAYER-002).

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, parseList } from "./frontmatter";

export type SkillSource = "global" | "project";

export type SkillMeta = {
    name: string;
    description: string;
    allowedTools: string[];
    dir: string;
    source: SkillSource;
};

export type LoadedSkill = SkillMeta & {
    body: string;
    resources: string[];
};

const MAX_SKILL_BODY_CHARS = 20_000;
const MAX_RESOURCES = 50;

export function skillRoots(cwd: string): { dir: string; source: SkillSource }[] {
    const userDir = process.env.ANCIENT_USER_DIR ?? join(homedir(), ".ancient");
    const roots: { dir: string; source: SkillSource }[] = [
        { dir: join(userDir, "skills"), source: "global" },
    ];
    if (cwd) roots.push({ dir: join(cwd, ".ancient", "skills"), source: "project" });
    return roots;
}

async function readSkillMeta(dir: string, source: SkillSource): Promise<SkillMeta | null> {
    let raw: string;
    try {
        raw = await readFile(join(dir, "SKILL.md"), "utf-8");
    } catch {
        return null; // no SKILL.md — not a skill directory
    }
    const { data } = parseFrontmatter(raw);
    const name = data.name?.trim() || dir.split(/[\\/]/).pop()!;
    return {
        name,
        description: (data.description ?? "").trim().slice(0, 300),
        allowedTools: parseList(data["allowed-tools"]),
        dir,
        source,
    };
}

/**
 * Scans all skill roots for a cwd. Project skills shadow global skills of the
 * same name. Malformed skills are skipped, never fatal.
 */
export async function listSkills(cwd: string): Promise<SkillMeta[]> {
    const byName = new Map<string, SkillMeta>();
    for (const { dir: root, source } of skillRoots(cwd)) {
        let entries: string[];
        try {
            entries = await readdir(root);
        } catch {
            continue; // root absent — fine
        }
        for (const entry of entries) {
            const dir = join(root, entry);
            try {
                if (!(await stat(dir)).isDirectory()) continue;
            } catch {
                continue;
            }
            const meta = await readSkillMeta(dir, source);
            if (meta) byName.set(meta.name, meta); // later roots override earlier
        }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Load a skill's full body + resource listing (the expensive deferred read). */
export async function loadSkill(cwd: string, name: string): Promise<LoadedSkill | null> {
    const meta = (await listSkills(cwd)).find((s) => s.name === name);
    if (!meta) return null;

    const raw = await readFile(join(meta.dir, "SKILL.md"), "utf-8");
    const { body } = parseFrontmatter(raw);

    let resources: string[] = [];
    try {
        resources = (await readdir(meta.dir))
            .filter((f) => f !== "SKILL.md")
            .slice(0, MAX_RESOURCES);
    } catch {
        // directory unreadable — body still works
    }

    return {
        ...meta,
        body:
            body.length > MAX_SKILL_BODY_CHARS
                ? body.slice(0, MAX_SKILL_BODY_CHARS) + "\n... (skill body truncated)"
                : body,
        resources,
    };
}

/** Token-lean index injected into a prompt: one line per skill. */
export function buildSkillsPromptBlock(skills: SkillMeta[]): string {
    if (skills.length === 0) return "";
    const lines = skills.map(
        (s) => `- **${s.name}**${s.source === "project" ? " (project)" : ""} — ${s.description || "no description"}`,
    );
    return [
        "## Available Skills",
        "Specialized instruction packages. When a task matches a skill's description, call the `useSkill` tool with its name BEFORE starting work — the full instructions load only then. Do not load skills you don't need.",
        ...lines,
    ].join("\n");
}