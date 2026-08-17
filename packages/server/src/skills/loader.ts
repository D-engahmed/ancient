// file: packages/server/src/skills/loader.ts
// Skills system — Claude-Code-style SKILL.md packages with progressive
// disclosure. Only `name + description` ever enter the system prompt; the
// full skill body is pulled in on demand via the `useSkill` tool (or a
// matching slash command). This keeps the standing token cost of a large
// skill library near zero.

import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { parseFrontmatter, parseList } from "../lib/frontmatter";
import { skillDirs } from "../lib/workspace";

export type SkillSource = "global" | "project";

export type SkillMeta = {
    /** Skill name — directory name by default, frontmatter `name:` wins. */
    name: string;
    /** One-line trigger description shown to the model. Keep it < 120 chars. */
    description: string;
    /** Optional comma list of tool names the skill is allowed to use. */
    allowedTools: string[];
    /** Absolute path to the skill directory (SKILL.md + bundled resources). */
    dir: string;
    source: SkillSource;
};

export type LoadedSkill = SkillMeta & {
    /** Full SKILL.md body — only read when the skill is activated. */
    body: string;
    /** Other files bundled inside the skill directory (scripts, references). */
    resources: string[];
};

const MAX_SKILL_BODY_CHARS = 20_000;
const MAX_RESOURCES = 50;

async function readSkillMeta(dir: string, source: SkillSource): Promise<SkillMeta | null> {
    const file = join(dir, "SKILL.md");
    let raw: string;
    try {
        raw = await readFile(file, "utf-8");
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
 * Scans all skill directories for a workspace. Project skills shadow global
 * skills of the same name. Malformed skills are skipped, never fatal.
 */
export async function listSkills(cwd: string | null): Promise<SkillMeta[]> {
    const byName = new Map<string, SkillMeta>();
    const dirs = skillDirs(cwd);

    for (const root of dirs) {
        const source: SkillSource = root.includes(join(".ancient", "skills")) && cwd && root.startsWith(cwd)
            ? "project"
            : "global";
        let entries: string[];
        try {
            entries = await readdir(root);
        } catch {
            continue;
        }
        for (const entry of entries) {
            const dir = join(root, entry);
            try {
                if (!(await stat(dir)).isDirectory()) continue;
            } catch {
                continue;
            }
            const meta = await readSkillMeta(dir, source);
            if (meta) byName.set(meta.name, meta); // later dirs override earlier
        }
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Loads a skill's full body + resource listing. This is the expensive read
 *  that progressive disclosure exists to defer. */
export async function loadSkill(cwd: string | null, name: string): Promise<LoadedSkill | null> {
    const metas = await listSkills(cwd);
    const meta = metas.find((s) => s.name === name);
    if (!meta) return null;

    const raw = await readFile(join(meta.dir, "SKILL.md"), "utf-8");
    const { body } = parseFrontmatter(raw);

    let resources: string[] = [];
    try {
        resources = (await readdir(meta.dir))
            .filter((f) => f !== "SKILL.md")
            .slice(0, MAX_RESOURCES);
    } catch {
        // directory unreadable — fine, body still works
    }

    return {
        ...meta,
        body: body.length > MAX_SKILL_BODY_CHARS
            ? body.slice(0, MAX_SKILL_BODY_CHARS) + "\n... (skill body truncated)"
            : body,
        resources,
    };
}

/**
 * Token-lean index injected into the system prompt: one line per skill.
 * Roughly 15–40 tokens per skill versus hundreds for the full body.
 */
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
