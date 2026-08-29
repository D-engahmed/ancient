// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Skills tools (capabilities/skills): `listSkills` + `useSkill`, both category
// `read` (allowed by the default ApprovalPolicy) — the progressive-disclosure
// half of the skills system (A-CAP-001).

import { toolInputSchemas } from "@ANCIENT/shared";
import type { ToolDefinition } from "../core/types";
import { listSkills as list, loadSkill } from "./loader";

/** Token-lean catalog of installed skills (name/description only). */
export const listSkillsTool: ToolDefinition = {
    name: "listSkills",
    description:
        "List available skills (name + one-line description). Use when a task may match a specialized instruction package.",
    inputSchema: toolInputSchemas.listSkills,
    category: "read",
    execute: async (scope) => {
        const skills = await list(scope.cwd);
        return {
            skills: skills.map((s) => ({
                name: s.name,
                source: s.source,
                description: s.description || undefined,
            })),
        };
    },
};

/** Load the full body of one skill on demand. */
export const useSkillTool: ToolDefinition = {
    name: "useSkill",
    description:
        "Load the full instructions of an available skill by name. Call this BEFORE starting work that matches a skill's description.",
    inputSchema: toolInputSchemas.useSkill,
    category: "read",
    target: (a) => (a as { name?: string }).name,
    execute: async (scope, args) => {
        const { name } = args as { name: string };
        const skill = await loadSkill(scope.cwd, name);
        if (!skill) {
            return { error: `Skill not found: ${name}. Check the Available Skills list for exact names.` };
        }
        return {
            name: skill.name,
            source: skill.source,
            instructions: skill.body,
            bundledResources: skill.resources,
            note:
                skill.resources.length > 0
                    ? `This skill ships resource files in its directory. Read them with readFile if the instructions reference them.`
                    : undefined,
        };
    },
};

/** The skills capability: catalog + progressive-disclosure loader. */
export function skillsCapability(): ToolDefinition[] {
    return [listSkillsTool, useSkillTool];
}