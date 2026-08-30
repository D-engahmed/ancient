// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Engine runtime (engine/runtime) — the StrategyRuntime port strategies run on
// (A-STRAT-001). `listTools` reads the mode-gated, allow-listed registry slice;
// `executeTool` runs every call through the capability central edge (approval →
// consent → parse → execute → budget → redact); `runModel` delegates to the
// injected ModelChat. Strategies observe only serialized results.

import { executeTool as runCapabilityTool } from "@ANCIENT/capabilities/core";
import type { ExecuteToolOptions } from "@ANCIENT/capabilities/core";
import type { CapabilityRegistry } from "@ANCIENT/capabilities/core";
import type { ConsentProvider, ExecutionScope } from "@ANCIENT/capabilities/core";
import type { ApprovalPolicy, Redactor } from "@ANCIENT/infrastructure/security";
import type { ModelToolCall, RuntimeTool, StrategyRuntime, ToolFailure, ToolResult } from "@ANCIENT/strategies";
import type { ModeType } from "@ANCIENT/shared";
import type { EngineContext } from "./context";
import type { ModelChat } from "./types";

export type EngineRuntimeOptions = {
    registry: CapabilityRegistry;
    scope: ExecutionScope;
    model: ModelChat;
    mode?: ModeType;
    allow?: readonly string[];
    policy: ApprovalPolicy;
    consentProvider?: ConsentProvider;
    redactor?: Redactor;
    /** Engine-owned context (A-ENG-002) applied at the model port. */
    context?: EngineContext;
};

/** Wire the strategy layer to the capability runtime + a model chat port. */
export function createStrategyRuntime(opts: EngineRuntimeOptions): StrategyRuntime {
    const edgeOpts: ExecuteToolOptions = {
        policy: opts.policy,
        consentProvider: opts.consentProvider,
        redactor: opts.redactor,
    };

    return {
        async listTools(): Promise<RuntimeTool[]> {
            return opts.registry.listFor(opts.mode ?? "BUILD", opts.allow).map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
            }));
        },

        async runModel(input) {
            const context = opts.context;
            if (!context) return opts.model(input);

            // Engine context is authoritative: the strategy's own system prompt
            // becomes an execution directive layered beneath it, the task brief is
            // guaranteed present, and history is trimmed to the run's budget.
            const system = context.system + (input.system ? `\n\n# Execution directive\n${input.system}` : "");
            const prompt = input.prompt ?? context.brief;
            const history = context.trimHistory(input.history ?? []);
            return opts.model({ ...input, system, prompt, history });
        },

        async executeTool(call: ModelToolCall): Promise<ToolResult> {
            const tool = opts.registry.get(call.name);
            if (!tool) {
                const failure: ToolFailure = {
                    code: "CAPABILITY_EXECUTION_FAILED",
                    message: `unknown tool '${call.name}'`,
                    transient: false,
                    retryableAsIs: false,
                    partialEffect: "none",
                };
                return { text: `error: ${failure.message}`, ok: false, failure };
            }

            const result = await runCapabilityTool(tool, opts.scope, call.args, edgeOpts);
            if (!result.ok) {
                // The central edge already classified the failure (docs/05 §5.2);
                // only fall back to a conservative envelope if it has no typed one.
                const failure: ToolFailure =
                    result.failure ?? {
                        code: "CAPABILITY_EXECUTION_FAILED",
                        message: result.error ?? "tool failed",
                        transient: false,
                        retryableAsIs: false,
                        partialEffect: "unknown",
                    };
                return { text: `error: ${failure.message}`, ok: false, failure };
            }

            // Already serialized + redacted + budget-capped at the central edge.
            return { text: result.output, ok: true };
        },
    };
}