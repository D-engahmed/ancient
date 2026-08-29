// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Skills capability tests (capabilities/skills). 12 tests — hermetic via
// ANCIENT_USER_DIR, no dependence on the real home directory.

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CapabilityRegistry, executeTool } from "../core";
import { ApprovalPolicy } from "@ANCIENT/infrastructure/security";
import type { ExecutionScope } from "../core/types";
import { buildSkillsPromptBlock, listSkills as list, loadSkill } from "./loader";
import { listSkillsTool, skillsCapability, useSkillTool } from "./tools";

let root: string;
let globalSkills: string;
let projectCwd: string;
let scope: ExecutionScope;
const policy = new ApprovalPolicy();

const GLOBAL_REVIEW = `---
name: review-coder
description: Review code for correctness
allowed-tools: readFile, grep
---

# Review

Always start with the diff.
`;
const PROJECT_REVIEW = `---
description: Project override of review-coder
allowed-tools: readFile, grep
---

# Review (project)

Project-specific rules.
`;
const PROJECT_ONLY = `---
description: Only exists in the project
---

# Project skill

Work here.
`;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "caps-skills-"));
    globalSkills = join(root, "user", ".ancient", "skills");
    projectCwd = join(root, "project");
    process.env.ANCIENT_USER_DIR = join(root, "user", ".ancient");

    await mkdir(join(globalSkills, "review-coder"), { recursive: true });
    await mkdir(join(projectCwd, ".ancient", "skills", "review-coder"), { recursive: true });
    await mkdir(join(projectCwd, ".ancient", "skills", "project-only"), { recursive: true });

    await writeFile(join(globalSkills, "review-coder", "SKILL.md"), GLOBAL_REVIEW);
    await writeFile(join(projectCwd, ".ancient", "skills", "review-coder", "SKILL.md"), PROJECT_REVIEW);
    await writeFile(join(projectCwd, ".ancient", "skills", "project-only", "SKILL.md"), PROJECT_ONLY);

    scope = { cwd: projectCwd };
});

afterAll(async () => {
    delete process.env.ANCIENT_USER_DIR;
    await rm(root, { recursive: true, force: true });
});

describe("loader", () => {
    it("lists skills from both roots, project shadows global", async () => {
        const skills = await list(projectCwd);
        const names = skills.map((s) => s.name);
        expect(names).toEqual(["project-only", "review-coder"]);
        expect(skills.find((s) => s.name === "review-coder")?.source).toBe("project");
        expect(skills.find((s) => s.name === "project-only")?.source).toBe("project");
    });

    it("reads frontmatter name/description/allowed-tools", async () => {
        const review = (await list(projectCwd)).find((s) => s.name === "review-coder");
        expect(review?.description).toContain("Project override");
        expect(review?.allowedTools).toEqual(["readFile", "grep"]);
    });

    it("loads the full body with frontmatter stripped", async () => {
        const loaded = await loadSkill(projectCwd, "review-coder");
        expect(loaded?.body).toContain("Project-specific rules");
        expect(loaded?.body).not.toContain("allowed-tools");
        expect(loaded?.resources).toEqual([]);
    });

    it("returns null for an unknown skill", async () => {
        expect(await loadSkill(projectCwd, "nope")).toBeNull();
    });

    it("builds a token-lean prompt block", async () => {
        const block = buildSkillsPromptBlock([
            { name: "x", description: "d", allowedTools: [], dir: projectCwd, source: "project" },
        ]);
        expect(block).toContain("**x** (project) — d");
        expect(block).toContain("call the `useSkill` tool");
    });
});

describe("skills tools through the central edge", () => {
    it("listSkills returns the catalog under the default (read-allowed) policy", async () => {
        const res = await executeTool(listSkillsTool, scope, {}, { policy });
        expect(res.ok).toBe(true);
        const parsed = JSON.parse(res.output);
        expect(parsed.skills.map((s: { name: string }) => s.name)).toEqual(["project-only", "review-coder"]);
    });

    it("useSkill returns the body and resource note", async () => {
        const res = await executeTool(useSkillTool, scope, { name: "review-coder" }, { policy });
        const parsed = JSON.parse(res.output);
        expect(parsed.instructions).toContain("Project-specific rules");
        expect(parsed.source).toBe("project");
    });

    it("useSkill errors on an unknown name", async () => {
        const res = await executeTool(useSkillTool, scope, { name: "missing" }, { policy });
        expect(JSON.parse(res.output).error).toContain("not found");
    });

    it("useSkill rejects invalid args (name required)", async () => {
        const res = await executeTool(useSkillTool, scope, {}, { policy });
        expect(res.ok).toBe(false);
        expect(res.error).toContain("invalid arguments");
    });
});

describe("skillsCapability wired into the registry", () => {
    it("registers both tools as read (PLAN-safe)", () => {
        const registry = new CapabilityRegistry().registerAll(skillsCapability());
        expect(registry.listNames().sort()).toEqual(["listSkills", "useSkill"]);
        expect(registry.get("useSkill")?.category).toBe("read");
        expect(registry.listFor("PLAN").map((t) => t.name)).toContain("useSkill");
        expect(registry.listFor("BUILD").map((t) => t.name)).toContain("listSkills");
    });

    it("exposes the skill name as the approval target", () => {
        expect(useSkillTool.target?.({ name: "review-coder" })).toBe("review-coder");
    });
});