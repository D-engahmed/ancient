import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { requireAuth } from "./middleware/require-auth";
import sessions from "./routes/sessions";
import chat from "./routes/chat";
import auth from "./routes/auth";
import providerConnections from "./routes/provider-connections"; // <-- must be imported

const app = new Hono();

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message || "Request failed" }, error.status);
  }
  console.error("Unhandled server error", error);
  return c.json({ error: "Internal server error" }, 500);
});

app.use("/sessions/*", requireAuth);
app.use("/chat/*", requireAuth);
app.use("/provider-connections/*", requireAuth); // <-- must be added

const routes = app
  .route("/auth", auth)
  .route("/sessions", sessions)
  .route("/chat", chat)
  .route("/provider-connections", providerConnections); // <-- must be mounted

export type AppType = typeof routes;
export default { port: 3000, fetch: app.fetch, idleTimeout: 255 };