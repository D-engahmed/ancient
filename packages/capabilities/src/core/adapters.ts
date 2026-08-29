// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// AI-SDK adapter (capabilities/core).
//
// Turns a mode-gated, allow-listed slice of the registry into an AI-SDK `ToolSet`.
// The wrapper runs every call through the same central edge as executeTool()
// (approval → consent → parse → execute → budget), then returns the serialized
// redacted output string. A denial/error throws so the SDK surfaces it to the model
// as a tool failure the model can recover from.

import type { ApprovalPolicy } from "@ANCIENT/infrastructure/security";
import type { Redactor } from "@ANCIENT/infrastructure/security";
import type { ModeType } from "@ANCIENT/shared";
import type { Tool } from "ai";
import { executeTool, type ExecuteToolOptions } from "./execute";
import type { CapabilityRegistry } from "./registry";
import type { ConsentProvider, ExecutionScope } from "./types";

export type ToToolSetOptions = {
    mode?: ModeType;
    allow?: readonly string[];
    scope: ExecutionScope;
    policy: ApprovalPolicy;
    consentProvider?: ConsentProvider;
    redactor?: Redactor;
};

/** Produces an AI-SDK tool set from a registry slice. */
export function toToolSet(
    registry: CapabilityRegistry,
    opts: ToToolSetOptions,
): Record<string, Tool> {
    const edgeOpts: ExecuteToolOptions = {
        policy: opts.policy,
        consentProvider: opts.consentProvider,
        redactor: opts.redactor,
    };

    const sdk: Record<string, Tool> = {};
    for (const tool of registry.listFor(opts.mode ?? "BUILD", opts.allow)) {
        sdk[tool.name] = {
            description: tool.description,
            inputSchema: tool.inputSchema,
            execute: async (args: unknown) => {
                const result = await executeTool(tool, opts.scope, args, edgeOpts);
                if (!result.ok) {
                    throw new Error(result.error ?? `${tool.name}: failed`);
                }
                return result.output;
            },
        } as Tool;
    }
    return sdk;
}