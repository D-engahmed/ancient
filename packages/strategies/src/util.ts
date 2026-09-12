// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Strategy utilities (strategies) — shared helpers for the wired strategies.

import type { UsageTokens } from "@ANCIENT/infrastructure/providers";
import type { ToolResult } from "./types";

export function EMPTY_USAGE(): UsageTokens {
    return { inputTokens: 0, outputTokens: 0 };
}

export function sumUsage(a: UsageTokens, b?: UsageTokens): UsageTokens {
    if (!b) return a;
    return {
        inputTokens: a.inputTokens + (b.inputTokens ?? 0),
        outputTokens: a.outputTokens + (b.outputTokens ?? 0),
    };
}

/**
 * The text a strategy hands the model for one executed call. Success: the
 * serialized, redacted output as-is. Failure: the typed ToolFailure
 * (code / transient / retryableAsIs / partialEffect) is prepended so the
 * model's retry-vs-abandon decision is driven by the SAME classification the
 * engine uses — not by guessing from a bare error message.
 */
export function toolFeedbackText(res: ToolResult): string {
    if (!res.failure) return res.text;
    const f = res.failure;
    return `error: [${f.code} · transient=${f.transient} · retryableAsIs=${f.retryableAsIs} · partialEffect=${f.partialEffect}] ${f.message}`;
}

/** Extracts a JSON object from model text that may be wrapped in a code fence. */
export function extractJson(text: string): unknown {
    const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    const candidate = (fenced ? (fenced[1] ?? "") : text).trim();
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
        return JSON.parse(candidate.slice(start, end + 1));
    } catch {
        return null;
    }
}