// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// file: packages/server/src/tools/index.ts

import type { Mode } from "@ANCIENT/database/enums";
import type { ChatModelSelection } from "@ANCIENT/shared";
import type { ToolSet } from "ai";
import { createBaseTools } from "./base";
import { createUseSkillTool } from "./use-skill";
import { createTaskTool } from "./task";
import { getMcpTools } from "../mcp/client";
import type { HookContext } from "../hooks/runner";
import { checkPreToolUse, collectPostToolContext } from "../hooks/runner";

export type CreateToolsOptions = {
    /** Present when the caller wants hooks + subagent support. */
    sessionId?: string;
    userId?: string;
    selection?: ChatModelSelection;
    hookContext?: HookContext;
    /** MCP tools already resolved by the caller (async), keyed by name. */
    mcpTools?: Record<string, unknown>;
};

type AnyTool = { execute?: (args: never, opts: never) => Promise<unknown> };

/**
 * Wraps a tool's execute with the PreToolUse/PostToolUse hook pipeline.
 * A blocking PreToolUse decision turns the call into an error result the
 * model can see and route around.
 */
function withHooks<T extends AnyTool>(name: string, t: T, hookContext: HookContext): T {
    if (typeof t.execute !== "function") return t;
    const original = t.execute.bind(t);
    return {
        ...t,
        execute: async (args: unknown, opts: unknown) => {
            const blockReason = await checkPreToolUse(hookContext, name, args);
            if (blockReason) {
                return { error: `Tool call blocked by hook: ${blockReason}` };
            }
            const result = await (original as (a: unknown, o: unknown) => Promise<unknown>)(args, opts);
            const extra = await collectPostToolContext(hookContext, name, args, result);
            if (extra.length === 0) return result;
            if (typeof result === "object" && result !== null) {
                return { ...result, hookContext: extra.join("\n") };
            }
            return { result, hookContext: extra.join("\n") };
        },
    } as T;
}

/**
 * Full tool registry for one turn: core tools + useSkill + task (subagents)
 * + MCP tools, all wrapped in the hook pipeline when a hook context exists.
 *
 * `createTools` stays synchronous for legacy callers (PLAN dialogs etc.);
 * use `createToolsAsync` from the chat route so MCP tools are included.
 */
export function createTools(cwd: string, mode: Mode, opts: CreateToolsOptions = {}): ToolSet {
    const base = createBaseTools(cwd, mode);
    const tools: Record<string, unknown> = {
        ...base,
        useSkill: createUseSkillTool(cwd),
    };

    // Subagents need a model selection + user to resolve against.
    if (opts.sessionId && opts.userId && opts.selection) {
        tools.task = createTaskTool({
            cwd,
            mode,
            userId: opts.userId,
            selection: opts.selection,
        });
    }

    if (opts.mcpTools) {
        Object.assign(tools, opts.mcpTools);
    }

    if (opts.hookContext) {
        const wrapped: Record<string, unknown> = {};
        for (const [name, t] of Object.entries(tools)) {
            wrapped[name] = withHooks(name, t as AnyTool, opts.hookContext);
        }
        return wrapped as ToolSet;
    }

    return tools as ToolSet;
}

/** Async variant that also resolves MCP tools. Used by the chat route. */
export async function createToolsAsync(cwd: string, mode: Mode, opts: CreateToolsOptions = {}): Promise<ToolSet> {
    let mcpTools: Record<string, unknown> | undefined;
    try {
        mcpTools = await getMcpTools(cwd);
    } catch {
        mcpTools = undefined; // MCP is best-effort
    }
    return createTools(cwd, mode, { ...opts, mcpTools });
}
