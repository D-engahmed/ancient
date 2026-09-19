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
import { createExecutionsRoutes } from "./routes/executions";
import { createV1Routes } from "./routes/v1";
import { ExecutionHub } from "./executions/hub";

const app = new Hono<{ Variables: { traceId: string } }>();

app.use("*", traceId);

const hub = new ExecutionHub();

// Kubernetes/load-balancer probes.
// /health/live never depends on external infrastructure.
// /health/ready verifies the database when DATABASE_URL is configured.
app.get("/health/live", (c) => c.json({ status: "ok" }));

app.get("/health/ready", async (c) => {
  if (!process.env.DATABASE_URL) {
    return c.json({ status: "not_ready", reason: "DATABASE_URL is not configured" }, 503);
  }
  try {
    const { db } = await import("@ANCIENT/database/client");
    await db.$queryRaw`SELECT 1`;
    return c.json({ status: "ready" });
  } catch (error) {
    if (process.env.ANCIENT_DEBUG_ERRORS === "1") console.error(error);
    return c.json({ status: "not_ready", reason: "database unavailable" }, 503);
  }
});

app.notFound((c) => guardJson(c, "Not found", 404));

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return guardJson(c, error.message || "Request failed", error.status);
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error("Unhandled server error:", message);
  if (process.env.ANCIENT_DEBUG_ERRORS === "1") console.error(error);
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
  .route("/executions", createExecutionsRoutes(hub))
  .route("/v1", createV1Routes(hub));

export type AppType = typeof routes;
export default { port: Number(process.env.PORT ?? 3000), fetch: app.fetch, idleTimeout: 255 };
