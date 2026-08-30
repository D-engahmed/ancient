// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { traceId } from "./middleware/trace-id";
import { requireAuth } from "./middleware/require-auth";
import { byokRateLimit } from "./middleware/byok-rate-limit";
import { errorJson, genericMessageFor, guardJson } from "./lib/error-mapper";
import sessions from "./routes/sessions";
import chat from "./routes/chat";
import auth from "./routes/auth";
import providerConnections from "./routes/provider-connections";
import extensions from "./routes/extensions";
import usage from "./routes/usage";
import agent from "./routes/agent";
import pipeline from "./routes/pipeline";
import executions from "./routes/executions";

const app = new Hono<{ Variables: { traceId: string } }>();

/** First-in-chain: every response (incl. onError) carries X-Trace-Id. */
app.use("*", traceId);

app.notFound((c) => guardJson(c, "Not found", 404));

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return guardJson(c, error.message || "Request failed", error.status);
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
  return errorJson(c, error);
});

app.use("/sessions/*", requireAuth);
app.use("/chat/*", requireAuth);
app.use("/chat/*", byokRateLimit);
app.use("/provider-connections/*", requireAuth);
app.use("/extensions/*", requireAuth);
app.use("/usage/*", requireAuth);
app.use("/agent/*", requireAuth);
app.use("/pipeline/*", requireAuth);
app.use("/executions/*", requireAuth);
// The AI-heavy surfaces share one per-user budget so a scripted burst of
// executions (or a runaway subagent fan-out) can't monopolize the upstream
// pool behind the gateway — same window/quota as /chat/*.
app.use("/executions/*", byokRateLimit);

const routes = app
  .route("/auth", auth)
  .route("/sessions", sessions)
  .route("/chat", chat)
  .route("/provider-connections", providerConnections)
  .route("/extensions", extensions)
  .route("/usage", usage)
  .route("/agent", agent)
  .route("/pipeline", pipeline)
  .route("/executions", executions);

export type AppType = typeof routes;
export default { port: 3000, fetch: app.fetch, idleTimeout: 255 };