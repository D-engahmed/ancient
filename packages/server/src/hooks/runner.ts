// file: packages/server/src/hooks/runner.ts
// Hook runner — executes user-configured shell commands around agent
// lifecycle events, Claude-Code-style. Payload goes in on stdin as JSON;
// the hook answers on stdout:
//
//   PreToolUse  → {"decision": "block", "reason": "..."} blocks the call
//   PostToolUse → {"additionalContext": "..."} is appended to the result
//   UserPromptSubmit → {"additionalContext": "..."} is appended to the prompt
//
// Hooks are best-effort: a failing or slow hook never crashes a turn.

import { spawn } from "child_process";
import { createLogger } from "@ANCIENT/shared";
import type { AncientSettings, HookDefinition, HookEvent } from "./settings";
import { hooksFor, matcherMatches } from "./settings";

const log = createLogger("hooks");
const DEFAULT_TIMEOUT_MS = 10_000;

export type HookContext = {
    cwd: string;
    sessionId: string;
    settings: AncientSettings;
};

export type HookOutput = {
    decision?: "block";
    reason?: string;
    additionalContext?: string;
};

function runHookCommand(
    hook: HookDefinition,
    payload: Record<string, unknown>,
    cwd: string,
): Promise<HookOutput | null> {
    return new Promise((resolvePromise) => {
        const timeoutMs = hook.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        let child;
        try {
            child = spawn("sh", ["-c", hook.command], {
                cwd,
                stdio: ["pipe", "pipe", "ignore"],
                env: { ...process.env, ANCIENT_HOOK: "1" },
            });
        } catch {
            resolvePromise(null);
            return;
        }

        let stdout = "";
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolvePromise(null);
        }, timeoutMs);

        child.stdout.on("data", (d) => {
            stdout += d.toString();
            if (stdout.length > 64_000) child.kill("SIGKILL"); // runaway hook
        });
        child.on("error", () => {
            clearTimeout(timer);
            resolvePromise(null);
        });
        child.on("close", () => {
            clearTimeout(timer);
            const text = stdout.trim();
            if (!text) return resolvePromise(null);
            try {
                const parsed = JSON.parse(text);
                if (typeof parsed === "object" && parsed !== null) {
                    resolvePromise(parsed as HookOutput);
                    return;
                }
            } catch {
                // Non-JSON stdout is treated as plain additionalContext —
                // convenient for simple hooks like `echo "remember to run tests"`.
                resolvePromise({ additionalContext: text.slice(0, 4_000) });
                return;
            }
            resolvePromise(null);
        });

        // A fast-exiting hook (e.g. `echo ...`) can close stdin before the
        // payload lands — swallow EPIPE instead of crashing the process.
        child.stdin.on("error", () => {});
        try {
            child.stdin.write(JSON.stringify(payload));
            child.stdin.end();
        } catch {
            resolvePromise(null);
        }
    });
}

/** Runs every hook for an event (sequentially — hooks can depend on order). */
export async function runHooks(
    ctx: HookContext,
    event: HookEvent,
    payload: Record<string, unknown>,
    toolName?: string,
): Promise<HookOutput[]> {
    const hooks = hooksFor(ctx.settings, event).filter((h) =>
        toolName ? matcherMatches(h.matcher, toolName) : true,
    );
    if (hooks.length === 0) return [];

    const fullPayload = {
        event,
        session_id: ctx.sessionId,
        cwd: ctx.cwd,
        ...payload,
    };

    const outputs: HookOutput[] = [];
    for (const hook of hooks) {
        try {
            const out = await runHookCommand(hook, fullPayload, ctx.cwd);
            if (out) outputs.push(out);
            // A blocking PreToolUse decision short-circuits the rest.
            if (event === "PreToolUse" && out?.decision === "block") break;
        } catch (err) {
            log.warn("hook failed", { event, command: hook.command, error: err instanceof Error ? err.message : String(err) });
        }
    }
    return outputs;
}

/**
 * Convenience: run PreToolUse for a tool call. Returns a block reason, or
 * null when the call may proceed.
 */
export async function checkPreToolUse(
    ctx: HookContext,
    toolName: string,
    input: unknown,
): Promise<string | null> {
    const outputs = await runHooks(ctx, "PreToolUse", { tool_name: toolName, tool_input: input }, toolName);
    const blocked = outputs.find((o) => o.decision === "block");
    return blocked ? (blocked.reason ?? "Blocked by a PreToolUse hook") : null;
}

/** Convenience: run PostToolUse and collect any additional context strings. */
export async function collectPostToolContext(
    ctx: HookContext,
    toolName: string,
    input: unknown,
    output: unknown,
): Promise<string[]> {
    const outputs = await runHooks(
        ctx,
        "PostToolUse",
        { tool_name: toolName, tool_input: input, tool_output: typeof output === "string" ? output.slice(0, 8_000) : output },
        toolName,
    );
    return outputs.map((o) => o.additionalContext).filter((s): s is string => Boolean(s));
}
