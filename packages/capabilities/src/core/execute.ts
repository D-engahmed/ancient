// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Central tool-execution edge (capabilities/core).
//
// A-CAP-001: approval, consent, arg parsing, result budgeting, and secret
// redaction all live HERE, not in each capability module. Every tool in the
// registry inherits the same security + budget + containment guarantees.

import type { ApprovalPolicy } from "@ANCIENT/infrastructure/security";
import type { Redactor } from "@ANCIENT/infrastructure/security";
import {
    capResultLength,
    DEFAULT_MAX_RESULT_CHARS,
    serializeResult,
    type ConsentProvider,
    type ExecutionResult,
    type ExecutionScope,
    type ToolDefinition,
} from "./types";

export type ExecuteToolOptions = {
    policy: ApprovalPolicy;
    consentProvider?: ConsentProvider;
    redactor?: Redactor;
};

/** Default consent flow: no provider ⇒ `require-consent` is treated as deny. */
export async function requestConsent(
    tool: ToolDefinition,
    scope: ExecutionScope,
    args: unknown,
    provider: ConsentProvider | undefined,
    reason: string,
): Promise<boolean> {
    if (!provider) return false;
    return Boolean(await provider({
        toolName: tool.name,
        category: tool.category,
        reason,
        target: tool.target?.(args),
    }));
}

/**
 * Parse → approve → consent → execute → serialize → redact → budget.
 * Never throws: all guard failures and executor errors become ok:false results.
 */
export async function executeTool(
    tool: ToolDefinition,
    scope: ExecutionScope,
    rawArgs: unknown,
    opts: ExecuteToolOptions,
): Promise<ExecutionResult> {
    // 1. Parse — malformed args are a caller error, surfaced not thrown.
    let args: unknown;
    try {
        args = tool.inputSchema.parse(rawArgs);
    } catch {
        return {
            ok: false,
            output: "",
            truncated: false,
            redacted: [],
            approval: "args-invalid",
            error: `${tool.name}: invalid arguments`,
        };
    }

    // 2. Approval — the infra consent boundary.
    const approval = opts.policy.evaluate({
        name: tool.name,
        category: tool.category,
        target: tool.target?.(args),
    });

    if (approval.decision === "deny") {
        return {
            ok: false,
            output: "",
            truncated: false,
            redacted: [],
            approval: approval.reason,
            error: `${tool.name}: denied — ${approval.reason}`,
        };
    }

    if (approval.decision === "require-consent") {
        const granted = await requestConsent(tool, scope, args, opts.consentProvider, approval.reason);
        if (!granted) {
            return {
                ok: false,
                output: "",
                truncated: false,
                redacted: [],
                approval: approval.reason,
                error: `${tool.name}: consent not granted — ${approval.reason}`,
            };
        }
    }

    // 3. Execute.
    let value: unknown;
    try {
        value = await tool.execute(scope, args as never);
    } catch (err) {
        return {
            ok: false,
            output: "",
            truncated: false,
            redacted: [],
            approval: approval.reason,
            error: `${tool.name}: ${err instanceof Error ? err.message : String(err)}`,
        };
    }

    // 4. Serialize + redact + budget.
    let text = serializeResult(value);
    const redactor = opts.redactor;
    const redactedNames = redactor ? redactor.redact(text).redacted : [];
    if (redactor) text = redactor.mask(text);
    const { text: capped, truncated } = capResultLength(
        text,
        tool.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS,
    );

    return {
        ok: true,
        output: capped,
        truncated,
        redacted: redactedNames,
        approval: approval.reason,
    };
}