// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { createMiddleware } from "hono/factory";
import { authenticateOAuthRequest } from "../lib/auth";

export type AuthenticatedEnv = {
  Variables: {
    userId: string;
    traceId: string;
  };
};

export const requireAuth = createMiddleware<AuthenticatedEnv>(async (c, next) => {
  try {
    const auth = await authenticateOAuthRequest(c.req.raw);
    if (!auth) {
      return c.json(
        {
          error: {
            code: "AUTH_UNAUTHENTICATED",
            message: "Unauthorized. Run /login to continue.",
            retryable: false,
            traceId: c.get("traceId"),
          },
        },
        401,
      );
    }
    c.set("userId", auth.userId);
    await next();
  } catch {
    return c.json(
      {
        error: {
          code: "AUTH_UNAUTHENTICATED",
          message: "Unauthorized. Run /login to continue.",
          retryable: false,
          traceId: c.get("traceId"),
        },
      },
      401,
    );
  }
});