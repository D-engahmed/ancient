// file: packages/server/src/lib/dedupe-tool.ts

import type { Tool } from "ai";

/**
 * Wraps a read-only tool so that an identical (name, args) call within the
 * same turn returns a short pointer instead of re-executing.
 *
 * Scope is intentionally ONE TURN, not the whole session: `seen` must be a
 * fresh Map created inside createTools() (called once per streamAIResponse
 * invocation), not a module-level singleton. A file can legitimately change
 * between turns (e.g. after writeFile/editFile), so cross-turn caching would
 * silently serve stale content — this only guards against the model calling
 * the same read twice in a row before it has any new information.
 *
 * Only wrap read-only tools (readFile, listDirectory, grep, glob). Do not
 * wrap writeFile/editFile/bash — those have side effects, and a repeated
 * call with identical args is either intentional or will fail naturally
 * (e.g. editFile's oldString no longer matching), which is informative on
 * its own.
 */
export function withDedupe<T extends Tool>(toolName: string, toolDef: T, seen: Map<string, unknown>): T {
    const originalExecute = toolDef.execute;
    if (!originalExecute) return toolDef;

    return {
        ...toolDef,
        execute: async (args: unknown, options: unknown) => {
            const key = `${toolName}:${JSON.stringify(args)}`;

            if (seen.has(key)) {
                return {
                    note: `You already called ${toolName} with these exact arguments earlier this turn — the result is already in your context above. No need to call it again.`,
                };
            }

            const result = await (originalExecute as (args: unknown, options: unknown) => unknown)(args, options);
            seen.set(key, result);
            return result;
        },
    } as T;
}