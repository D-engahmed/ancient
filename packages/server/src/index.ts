// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { requireAuth } from "./middleware/require-auth";
import { byokRateLimit } from "./middleware/byok-rate-limit";
import sessions from "./routes/sessions";
import chat from "./routes/chat";
import auth from "./routes/auth";
import providerConnections from "./routes/provider-connections";
import extensions from "./routes/extensions";
import usage from "./routes/usage";
import agent from "./routes/agent";
import pipeline from "./routes/pipeline";

const app = new Hono();

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message || "Request failed" }, error.status);
  }
  // `console.error("...", error)` used to print the raw error object. For
  // errors like Prisma's PrismaClientValidationError, `error.stack` embeds
  // that library's own minified source-highlighting/formatting code, so the
  // console filled with unreadable bundled JS instead of the actual "Unknown
  // field ..." message (which is at the top of `error.message` already).
  // Default to the clean message; opt into the full object with
  // ANCIENT_DEBUG_ERRORS=1 when you actually need a stack trace.
  const message = error instanceof Error ? error.message : String(error);
  console.error("Unhandled server error:", message);
  if (process.env.ANCIENT_DEBUG_ERRORS === "1") {
    console.error(error);
  }
  return c.json({ error: "Internal server error" }, 500);
});

app.use("/sessions/*", requireAuth);
app.use("/chat/*", requireAuth);
app.use("/chat/*", byokRateLimit);
app.use("/provider-connections/*", requireAuth);
app.use("/extensions/*", requireAuth);
app.use("/usage/*", requireAuth);
app.use("/agent/*", requireAuth);
app.use("/pipeline/*", requireAuth);

const routes = app
  .route("/auth", auth)
  .route("/sessions", sessions)
  .route("/chat", chat)
  .route("/provider-connections", providerConnections)
  .route("/extensions", extensions)
  .route("/usage", usage)
  .route("/agent", agent)
  .route("/pipeline", pipeline);

export type AppType = typeof routes;
export default { port: 3000, fetch: app.fetch, idleTimeout: 255 };