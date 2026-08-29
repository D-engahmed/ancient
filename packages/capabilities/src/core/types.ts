// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Capability core types (capabilities/core).
//
// The ToolDefinition is the unit of the capability runtime (A-CAP-001): a plain
// contract object — schema, risk category, mode gating, execute. It is deliberately
// not AI-SDK-shaped: the SDK adapter (adapters.ts) emits ToolSets from these; MCP
// tools (not AI-SDK native) fit the same contract.

import type { RiskCategory } from "@ANCIENT/infrastructure/security";
import type { ModeType } from "@ANCIENT/shared";
import type { z } from "zod";

/** Per-execution context handed to every tool executor. */
export type ExecutionScope = {
    /** Working directory every path resolves against (path containment). */
    cwd: string;
    /** Home directory for user-global lookups (skills, caches). */
    homedir?: string;
    sessionId?: string;
    /** Environment visible to spawned processes. */
    env?: Record<string, string | undefined>;
};

/** Maps a tool call's args to the target string used by approval rules. */
export type TargetExtractor = (args: unknown) => string | undefined;

/**
 * The atomic unit a capability module contributes to the registry.
 * `inputSchema` output type flows to `execute` args after central parse.
 */
export type ToolDefinition<TArgs = unknown, TResult = unknown> = {
    name: string;
    description: string;
    inputSchema: z.ZodType;
    category: RiskCategory;
    /** Modes in which the tool is exposed (default: all). Write tools set [BUILD]. */
    modes?: readonly ModeType[];
    /** Serialized-result cap in chars (default: {@link DEFAULT_MAX_RESULT_CHARS}). */
    maxResultChars?: number;
    /** Approve against this resolved target (e.g. absolute path, command, host). */
    target?: TargetExtractor;
    execute: (scope: ExecutionScope, args: TArgs) => Promise<TResult>;
};

/** Requests explicit user consent for a `require-consent` approval. */
export type ConsentProvider = (request: {
    toolName: string;
    category: RiskCategory;
    reason: string;
    target?: string;
}) => boolean | Promise<boolean>;

/**
 * Outcome of one centrally-policed tool execution. `output` is the serialized,
 * redacted, budget-capped string the engine/stream should surface.
 */
export type ExecutionResult = {
    ok: boolean;
    /** Serialized + redacted + budget-capped payload ("" when `ok === false`). */
    output: string;
    /** True when the serialized output had to be truncated to fit the budget. */
    truncated: boolean;
    /** Secret pattern names that were masked out of the output. */
    redacted: string[];
    /** The policy decision that permitted (or blocked) this call. */
    approval: string;
    error?: string;
};

export const DEFAULT_MAX_RESULT_CHARS = 100_000;

/** The result budget is a firm cap (ROADMAP: "no unbounded tool results"). */
export function capResultLength(text: string, maxChars: number): { text: string; truncated: boolean } {
    if (maxChars <= 0) return { text: "", truncated: text.length > 0 };
    if (text.length <= maxChars) return { text, truncated: false };
    return { text: text.slice(0, maxChars), truncated: true };
}

/** Systematic serialization so executors may return plain values or text. */
export function serializeResult(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === undefined) return "";
    if (value === null) return "null";
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}