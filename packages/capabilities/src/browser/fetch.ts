// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Web-read primitives (capabilities/browser) — fetch with timeout, HTML→text
// extraction, and byte caps. No browser-automation dependency: this is the
// honest "browser" for a terminal-first agent (read pages, not click them);
// full computer-use/Playwright capability stays on the roadmap.

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RAW_BYTES = 2_000_000; // guard on memory before extraction

export type FetchUrlResult = {
    url: string;
    finalUrl: string;
    status: number;
    contentType?: string;
    text: string;
    truncated: boolean;
};

/** HTML → readable-ish text: drops scripts/styles/comments/tags, decodes
 *  common entities, collapses whitespace. Deliberately naive — no deps. */
export function htmlToText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** Fetches a URL and returns extracted text. Returns a structured error
 *  (io failure, timeout, oversize) rather than throwing. */
export async function fetchUrl(
    url: string,
    opts: { maxChars?: number; timeoutMs?: number } = {},
): Promise<{ ok: true; result: FetchUrlResult } | { ok: false; error: string }> {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: `unsupported protocol: ${parsed.protocol}` };
    }

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "ANCIENT-browser/1.0" } });
        const finalUrl = res.url || url;
        const contentType = res.headers.get("content-type") ?? undefined;
        const isHtml = (contentType ?? "").toLowerCase().includes("text/html");

        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_RAW_BYTES) {
            return { ok: false, error: `response too large (${buf.length} bytes)` };
        }
        const raw = buf.toString("utf8");
        const text = (isHtml ? htmlToText(raw) : raw).slice(0, opts.maxChars ?? raw.length);

        return {
            ok: true,
            result: {
                url,
                finalUrl,
                status: res.status,
                contentType,
                text,
                truncated: text.length < (isHtml ? raw.length : raw.length),
            },
        };
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            return { ok: false, error: `timed out after ${timeoutMs}ms` };
        }
        return { ok: false, error: `failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
        clearTimeout(timer);
    }
}