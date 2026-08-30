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
    type CapabilityFailure,
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

/**
 * Build the typed failure associated with each edge verdict (docs/05 §5.2,
 * Layer 20 decision table). The engine's retry path keys off `transient` +
 * `retryableAsIs` + `partialEffect`, never the prose string.
 */
function failure(code: CapabilityFailure["code"], message: string, extras?: Partial<CapabilityFailure>): CapabilityFailure {
    return { code, message, transient: false, retryableAsIs: false, partialEffect: "none" as const, ...extras };
}

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
 * Never throws: all guard failures and executor errors become ok:false results
 * carrying a typed `CapabilityFailure` (Layer 20 §1).
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
        const f = failure("CAPABILITY_INVALID_ARGUMENT", `${tool.name}: invalid arguments`, { retryableAsIs: true });
        return { ok: false, output: "", truncated: false, redacted: [], approval: "args-invalid", error: f.message, failure: f };
    }

    // 2. Approval — the infra consent boundary. A denial is an EXPECTED policy
    // outcome (docs/02 §D), never a platform failure.
    const approval = opts.policy.evaluate({
        name: tool.name,
        category: tool.category,
        target: tool.target?.(args),
    });

    if (approval.decision === "deny") {
        const f = failure("POLICY_DENIED", `${tool.name}: denied — ${approval.reason}`, { retryableAsIs: true });
        return { ok: false, output: "", truncated: false, redacted: [], approval: approval.reason, error: f.message, failure: f };
    }

    if (approval.decision === "require-consent") {
        const granted = await requestConsent(tool, scope, args, opts.consentProvider, approval.reason);
        if (!granted) {
            const f = failure("POLICY_APPROVAL_REQUIRED", `${tool.name}: consent not granted — ${approval.reason}`);
            return { ok: false, output: "", truncated: false, redacted: [], approval: approval.reason, error: f.message, failure: f };
        }
    }

    // 3. Execute.
    let value: unknown;
    try {
        value = await tool.execute(scope, args as never);
    } catch (err) {
        // A throw may have happened mid-side-effect — assume conservative.
        const f = failure("CAPABILITY_EXECUTION_FAILED", `${tool.name}: ${err instanceof Error ? err.message : String(err)}`, {
            partialEffect: "unknown" as const,
        });
        return { ok: false, output: "", truncated: false, redacted: [], approval: approval.reason, error: f.message, failure: f };
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