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
import { zValidator } from "@hono/zod-validator";
import {
    SUPPORTED_CHAT_MODELS,
    EXPERIENCE_REGISTRY,
    experienceActionSchema,
    experienceToExecution,
    findExperience,
    type ExperienceId,
    type SupportedProvider,
} from "@ANCIENT/shared";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireApiKey } from "../middleware/require-api-key";
import { envApiKeyForProtocol } from "../lib/provider-registry";
import { guardJson } from "../lib/error-mapper";
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

    // Experiences (A-024): thin adapters over the one execution surface.
    app.get("/experiences", (c) =>
        c.json({
            experiences: EXPERIENCE_REGISTRY.map((e) => ({
                id: e.id,
                label: e.label,
                description: e.description,
                defaultMode: e.defaultMode,
                defaultAllow: [...e.defaultAllow],
            })),
        }),
    );

    app.post(
        "/experiences/:id",
        zValidator("json", experienceActionSchema),
        async (c) => {
            const experienceId = c.req.param("id") as ExperienceId;
            const exp = findExperience(experienceId);
            if (!exp) return guardJson(c, "Unknown experience", 404);

            const body = c.req.valid("json");
            const entry = await hub.start({
                userId: c.get("userId"),
                ...experienceToExecution({ ...body, experienceId }),
            });
            return c.json(
                {
                    executionId: entry.executionId,
                    experienceId,
                    status: entry.status,
                    task: entry.task,
                    mode: entry.mode,
                    modelRef: entry.modelRef,
                    lastSeq: entry.bridge.lastSeq,
                },
                202,
            );
        },
    );

    // The execution surface maps 1:1 onto the interactive hub contract —
    // same envelopes, same SSE framing, same validation.
    app.route("/executions", createExecutionsRoutes(hub));

    return app;
}

export default createV1Routes(new ExecutionHub());