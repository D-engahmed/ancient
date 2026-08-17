// file: packages/server/src/tools/task.ts
// `task` tool — delegates a self-contained unit of work to a subagent.
// The subagent runs its own agentic loop in an ISOLATED context window and
// returns only its final report to the main conversation. This is the main
// token-efficiency mechanism: a 30-tool-call exploration costs the main
// thread one tool result instead of 30.

import { generateText, stepCountIs } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { Mode } from "@ANCIENT/database/enums";
import type { ChatModelSelection } from "@ANCIENT/shared";
import { getAgent } from "../agents/loader";
import { createBaseTools } from "./base";
import { resolveChatModel, resolveFreeModel } from "../lib/models";
import { createLogger } from "@ANCIENT/shared";

const log = createLogger("task");

const SUBAGENT_MAX_STEPS = 30;
const SUBAGENT_MAX_REPORT_CHARS = 12_000;

export type TaskToolContext = {
    cwd: string;
    mode: Mode;
    userId: string;
    /** The session's model selection — used when the agent says `inherit`. */
    selection: ChatModelSelection;
};

export function createTaskTool(ctx: TaskToolContext) {
    return tool({
        description:
            "Delegate a self-contained task to a specialized subagent (see the Subagents list). The subagent works in its own context with its own tools and returns a final report. Use for codebase exploration, code review, and test running. Give it a COMPLETE brief — it cannot see this conversation.",
        inputSchema: z.object({
            agent: z.string().describe("Subagent name from the Subagents list"),
            prompt: z.string().describe("Complete, self-contained task brief for the subagent"),
        }),
        execute: async ({ agent, prompt }) => {
            const def = await getAgent(ctx.cwd, agent);
            if (!def) {
                return { error: `Unknown subagent: ${agent}. Check the Subagents list for exact names.` };
            }

            // Model resolution: `cheap` routes to the configured free/local
            // model when one exists, falling back to the session model.
            let model;
            let usedModel: string;
            try {
                if (def.model.kind === "cheap") {
                    const free = resolveFreeModel();
                    if (free) {
                        model = free.model;
                        usedModel = `${free.modelId} (free tier)`;
                    } else {
                        const resolved = await resolveChatModel(ctx.selection, ctx.userId);
                        model = resolved.model;
                        usedModel = `${resolved.modelId} (no free model configured — inherited)`;
                    }
                } else {
                    const resolved = await resolveChatModel(ctx.selection, ctx.userId);
                    model = resolved.model;
                    usedModel = resolved.modelId;
                }
            } catch (err) {
                return { error: `Could not resolve a model for subagent '${agent}': ${err instanceof Error ? err.message : String(err)}` };
            }

            const tools = createBaseTools(ctx.cwd, ctx.mode, def.tools);

            const started = Date.now();
            try {
                const result = await generateText({
                    model,
                    system: [
                        def.instructions,
                        "",
                        `Working directory: ${ctx.cwd}. All file paths you use are relative to it.`,
                        ctx.mode === "PLAN"
                            ? "The session is in PLAN mode: you have read-only tools only. Do not attempt modifications."
                            : "",
                    ].join("\n"),
                    prompt,
                    tools: tools as Parameters<typeof generateText>[0]["tools"],
                    stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
                });

                const report = result.text?.trim() || "(subagent finished without a text report)";
                const truncated = report.length > SUBAGENT_MAX_REPORT_CHARS
                    ? report.slice(0, SUBAGENT_MAX_REPORT_CHARS) + "\n... (report truncated)"
                    : report;

                log.info("subagent finished", {
                    agent, model: usedModel,
                    steps: result.steps.length,
                    ms: Date.now() - started,
                });

                return {
                    agent,
                    model: usedModel,
                    steps: result.steps.length,
                    report: truncated,
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log.warn("subagent failed", { agent, error: message });
                return { error: `Subagent '${agent}' failed: ${message}` };
            }
        },
    });
}
