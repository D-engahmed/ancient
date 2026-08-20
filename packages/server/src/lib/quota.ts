// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { db } from "@ANCIENT/database/client";

export type QuotaInfo = {
    limit: number;
    windowSeconds: number | null; // null = provider didn't say; caller assumes a default
    resetAt: Date | null;
    metric: string | null;
};

/**
 * Parses a real, provider-reported quota out of a 429 response body.
 *
 * Deliberately conservative: this only returns a value when the body
 * contains an actual numeric limit from the provider (currently: Gemini's
 * native RESOURCE_EXHAUSTED shape, which includes a QuotaFailure detail
 * with a concrete `quotaValue`). Shared-pool errors like OpenRouter's
 * "temporarily rate-limited upstream" 429 do NOT carry a personal quota
 * number — there is nothing trustworthy to persist there, so those are
 * left alone rather than faked into a number that would mislead the usage
 * graph.
 *
 * Extend the `// ---- Gemini shape ----` block below (or add a sibling
 * block) if another provider starts sending a similarly concrete quota
 * value worth tracking.
 */
export function parseQuotaFromError(responseBody: string | undefined): QuotaInfo | null {
    if (!responseBody) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(responseBody);
    } catch {
        return null;
    }

    // ---- Gemini shape ----
    // { error: { code, message, status: "RESOURCE_EXHAUSTED", details: [
    //   { "@type": ".../google.rpc.QuotaFailure", violations: [{ quotaMetric, quotaId, quotaValue }] },
    //   { "@type": ".../google.rpc.RetryInfo", retryDelay: "40s" },
    // ] } }
    const error = (parsed as { error?: unknown })?.error;
    if (error && typeof error === "object") {
        const details = (error as { details?: unknown }).details;
        if (Array.isArray(details)) {
            const quotaFailure = details.find(
                (d): d is { violations?: unknown } =>
                    !!d && typeof d === "object" && (d as { ["@type"]?: unknown })["@type"] === "type.googleapis.com/google.rpc.QuotaFailure",
            );
            const violation = Array.isArray(quotaFailure?.violations) ? quotaFailure.violations[0] : undefined;
            const quotaValue = violation && typeof violation === "object" ? (violation as { quotaValue?: unknown }).quotaValue : undefined;
            const limit = typeof quotaValue === "string" ? Number.parseInt(quotaValue, 10) : undefined;

            if (limit !== undefined && Number.isFinite(limit) && limit > 0) {
                const quotaId = violation && typeof violation === "object" ? (violation as { quotaId?: unknown }).quotaId : undefined;
                const quotaMetric = violation && typeof violation === "object" ? (violation as { quotaMetric?: unknown }).quotaMetric : undefined;

                const windowSeconds = windowSecondsFromQuotaId(typeof quotaId === "string" ? quotaId : undefined);

                const retryInfo = details.find(
                    (d): d is { retryDelay?: unknown } =>
                        !!d && typeof d === "object" && (d as { ["@type"]?: unknown })["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
                );
                const retryDelay = retryInfo && typeof retryInfo === "object" ? (retryInfo as { retryDelay?: unknown }).retryDelay : undefined;
                const retrySeconds = typeof retryDelay === "string" ? Number.parseFloat(retryDelay) : undefined;
                const resetAt = retrySeconds !== undefined && Number.isFinite(retrySeconds)
                    ? new Date(Date.now() + retrySeconds * 1000)
                    : null;

                return {
                    limit,
                    windowSeconds,
                    resetAt,
                    metric: typeof quotaMetric === "string" ? quotaMetric.split("/").pop() ?? quotaMetric : null,
                };
            }
        }
    }

    return null;
}

function windowSecondsFromQuotaId(quotaId: string | undefined): number | null {
    if (!quotaId) return null;
    const id = quotaId.toLowerCase();
    if (id.includes("perminute")) return 60;
    if (id.includes("perhour")) return 3600;
    if (id.includes("perday")) return 86400;
    return null;
}

/**
 * Best-effort persistence — a failure here should never take down the
 * chat error response that triggered it, so this swallows its own errors.
 */
export async function persistQuota(connectionId: string, info: QuotaInfo): Promise<void> {
    try {
        await db.providerConnection.update({
            where: { id: connectionId },
            data: {
                lastKnownQuotaLimit: info.limit,
                lastKnownQuotaWindowSeconds: info.windowSeconds,
                lastKnownQuotaResetAt: info.resetAt,
                lastKnownQuotaMetric: info.metric,
            },
        });
    } catch {
        // Connection may have been deleted mid-flight, or the DB hiccuped —
        // either way, not worth failing the request over.
    }
}
