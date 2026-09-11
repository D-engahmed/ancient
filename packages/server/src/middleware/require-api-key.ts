// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Public platform API auth (ASSUMPTION-023). Independent of the interactive
// Clerk OAuth flow: a white-label product authenticates with one machine key
// (ANCIENT_PLATFORM_API_KEY). When the key is unset the API is NOT deployed —
// authentic routes return 404 so enabling the API is an explicit operator act,
// never a silent open.

import { createMiddleware } from "hono/factory";
import type { AuthenticatedEnv } from "./require-auth";
import { guardJson } from "../lib/error-mapper";

/** User id stamped on every /v1 request; executions key off it in the hub. */
export const PLATFORM_API_USER = "platform-api";

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export const requireApiKey = createMiddleware<AuthenticatedEnv>(async (c, next) => {
    const configured = process.env.ANCIENT_PLATFORM_API_KEY;
    if (!configured) {
        return guardJson(c, "Not found", 404);
    }
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;
    if (!token || !timingSafeEqual(configured, token)) {
        return c.json(
            {
                error: {
                    code: "AUTH_UNAUTHENTICATED",
                    message: "Invalid or missing platform API key.",
                    retryable: false,
                    traceId: c.get("traceId"),
                },
            },
            401,
        );
    }
    c.set("userId", PLATFORM_API_USER);
    await next();
});