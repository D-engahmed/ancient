// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Shell capability (capabilities/shell).
//
// One ToolDefinition (`bash`) contributing to the CapabilityRegistry (A-CAP-001)
// at category `exec` — denied by the default ApprovalPolicy (A-CAP-001 edge),
// denylist-checked inside the tool as a defense-in-depth floor even when exec
// is allowed.

import { spawn } from "node:child_process";
import { toolInputSchemas } from "@ANCIENT/shared";
import type { ToolDefinition } from "../core/types";
import { findDangerousCommandMatch } from "./dangerous-commands";

const DEFAULT_TIMEOUT = 30_000;
const MAX_OUTPUT = 20_000;

export type ShellResult = {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
};

function truncate(s: string, total: number): string {
    return total > MAX_OUTPUT ? s + `\n... (truncated, ${total} total chars)` : s;
}

function runCommand(command: string, cwd: string, timeoutMs: number): Promise<ShellResult> {
    return new Promise((resolve) => {
        let stdout = "";
        let stdoutTotal = 0;
        let stderr = "";
        let stderrTotal = 0;

        const collect = (bufferRef: { value: string; total: number }) => (chunk: Buffer | string) => {
            const s = chunk.toString();
            bufferRef.total += s.length;
            if (bufferRef.value.length < MAX_OUTPUT) {
                bufferRef.value += s;
                if (bufferRef.value.length > MAX_OUTPUT) bufferRef.value = bufferRef.value.slice(0, MAX_OUTPUT);
            }
        };

        const out = { value: stdout, total: stdoutTotal };
        const err = { value: stderr, total: stderrTotal };

        let timedOut = false;
        let settled = false;
        const settle = (result: Partial<ShellResult>) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
                stdout: truncate(out.value, out.total),
                stderr: truncate(err.value, err.total),
                exitCode: result.exitCode ?? null,
                timedOut: result.timedOut ?? false,
            });
        };

        const proc = spawn(command, {
            cwd,
            shell: true,
            env: { ...process.env, TERM: "dumb" },
        });

        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill("SIGKILL");
        }, timeoutMs);

        proc.stdout?.on("data", collect(out));
        proc.stderr?.on("data", collect(err));
        proc.on("error", (err) => settle({ exitCode: null, timedOut }));
        proc.on("close", (code) => settle({ exitCode: code, timedOut }));
    });
}

export const bashTool: ToolDefinition = {
    name: "bash",
    description:
        "Execute a shell command in the project directory. Use this for running tests, builds, git operations, package installs, and any other shell commands.",
    inputSchema: toolInputSchemas.bash,
    category: "exec",
    target: (a) => (a as { command?: string }).command,
    execute: async (scope, args) => {
        const input = args as { command: string; description?: string; timeout?: number };
        const blockedReason = findDangerousCommandMatch(input.command);
        if (blockedReason) {
            return {
                error: `Blocked before execution: this command matches a known-destructive pattern (${blockedReason}). If this is genuinely intended, the user needs to run it manually.`,
            };
        }
        try {
            return await runCommand(input.command, scope.cwd, input.timeout ?? DEFAULT_TIMEOUT);
        } catch (err) {
            return { error: `Failed to execute command: ${err instanceof Error ? err.message : String(err)}` };
        }
    },
};

/** The shell capability: the bash tool. */
export function shellCapability(): ToolDefinition[] {
    return [bashTool];
}