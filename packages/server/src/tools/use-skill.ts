// file: packages/server/src/tools/use-skill.ts
// `useSkill` tool — the activation half of progressive disclosure. The model
// sees only skill names/descriptions in the system prompt; calling this tool
// loads the full SKILL.md body into the conversation on demand.

import { tool } from "ai";
import { z } from "zod";
import { loadSkill } from "../skills/loader";

export function createUseSkillTool(cwd: string) {
    return tool({
        description:
            "Load the full instructions of an available skill by name. Call this BEFORE starting work that matches a skill's description. Returns the skill body and any bundled resource files.",
        inputSchema: z.object({
            name: z.string().describe("Exact skill name from the Available Skills list"),
        }),
        execute: async ({ name }) => {
            const skill = await loadSkill(cwd, name);
            if (!skill) {
                return { error: `Skill not found: ${name}. Check the Available Skills list for exact names.` };
            }
            return {
                name: skill.name,
                instructions: skill.body,
                bundledResources: skill.resources,
                note: skill.resources.length > 0
                    ? `This skill ships resource files in ${skill.dir}. Read them with readFile if the instructions reference them.`
                    : undefined,
            };
        },
    });
}
