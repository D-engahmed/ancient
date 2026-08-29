// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Browser capability (capabilities/browser): `fetchUrl` — category `network`,
// denied by the default ApprovalPolicy (fetch runs only when an operator
// allows `network`). Web-read only (A-CAP-001); no automation dependency.

import { toolInputSchemas } from "@ANCIENT/shared";
import type { ToolDefinition } from "../core/types";
import { fetchUrl } from "./fetch";

export const fetchUrlTool: ToolDefinition = {
    name: "fetchUrl",
    description:
        "Fetch a URL and return its readable text (HTML is stripped to text). Use for documentation, reference material, and simple lookups.",
    inputSchema: toolInputSchemas.fetchUrl,
    category: "network",
    target: (a) => (a as { url?: string }).url,
    execute: async (_scope, args) => {
        const input = args as { url: string; maxChars?: number; timeoutMs?: number };
        const out = await fetchUrl(input.url, {
            maxChars: input.maxChars,
            timeoutMs: input.timeoutMs,
        });
        if (!out.ok) return { error: out.error };
        return out.result;
    },
};

/** The browser capability: the web-read tool. */
export function browserCapability(): ToolDefinition[] {
    return [fetchUrlTool];
}