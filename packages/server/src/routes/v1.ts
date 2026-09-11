// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Public platform API (ASSUMPTION-023) — the versioned surface a white-label
// product (Coding/Design/Cowork) builds on. Auth is the platform API key
// (`require-api-key`), independent of the interactive Clerk flow. Every
// response reuses the exact typed wire envelopes from @ANCIENT/shared that
// the CLI consumes — a product is a client of the same contract, never a fork.
//
//   GET  /v1/models                        catalogue (platform-available / byok / unavailable)
//   POST /v1/executions                    start an execution
//   GET  /v1/executions                    list this API key's executions
//   GET  /v1/executions/:id                status snapshot
//   GET  /v1/executions/:id/events         SSE replay + live stream
//   POST /v1/executions/:id/cancel         request cancellation

import { Hono } from "hono";
import { SUPPORTED_CHAT_MODELS, type SupportedProvider } from "@ANCIENT/shared";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireApiKey } from "../middleware/require-api-key";
import { envApiKeyForProtocol } from "../lib/provider-registry";
import { ExecutionHub } from "../executions/hub";
import { createExecutionsRoutes } from "./executions";

const LOCAL_PROVIDERS: readonly SupportedProvider[] = ["ollama", "lmstudio", "vllm", "custom"];

function availabilityOf(provider: SupportedProvider): "platform" | "byok" | "unavailable" {
    if ((LOCAL_PROVIDERS as readonly string[]).includes(provider)) return "byok";
    return envApiKeyForProtocol(provider) ? "platform" : "unavailable";
}

export function platformModelCatalog() {
    return SUPPORTED_CHAT_MODELS.map((m) => ({
        id: m.id,
        provider: m.provider,
        pricing: m.pricing,
        available: availabilityOf(m.provider as SupportedProvider),
    }));
}

export function createV1Routes(hub: ExecutionHub) {
    const app = new Hono<AuthenticatedEnv>();
    app.use("*", requireApiKey);

    app.get("/models", (c) => c.json({ models: platformModelCatalog() }));

    // The execution surface maps 1:1 onto the interactive hub contract —
    // same envelopes, same SSE framing, same validation.
    app.route("/executions", createExecutionsRoutes(hub));

    return app;
}

export default createV1Routes(new ExecutionHub());