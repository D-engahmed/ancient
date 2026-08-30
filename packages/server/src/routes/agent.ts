// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// First real caller of @ANCIENT/agent. Before this file, the package
// compiled and had a dependency edge in package.json, but nothing in the
// server actually imported it — README's claimed /agent/* surface didn't
// exist. This implements the four operations it claims: templates, execute,
// status, and pause/resume/cancel.
//
// SCOPE / KNOWN LIMITS — read before assuming more than this does:
// - Execution state lives in one in-memory TeamOrchestrator for the whole
//   process (see `orchestrator` below). It does not survive a server restart and
//   will not work correctly behind more than one server instance sharing a
//   load balancer — status/pause/cancel for an execution only work against
//   whichever process instance is holding it. Fine for a single dev/small
//   deployment; needs a shared store (Redis, or the DB) before this scales
//   beyond one process.
// - A team's agents are all backed by the SAME provider connection (or the
//   same per-role connection, if you pass one) — the request does not accept
//   raw API keys. This mirrors how provider-connections.ts/chat.ts already
//   handle BYOK: encrypted at rest, decrypted per-request, never logged.
// - No persistence of runs to the database. If you want execution history
//   queryable after the process restarts, that's a real schema addition
//   (an AgentExecution table) — not something to fake here.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { db } from "@ANCIENT/database/client";
import { TeamOrchestrator, defaultRegistry } from "@ANCIENT/agent";
import type { ModelOverrides } from "@ANCIENT/agent/team";
import type { AgentRole, BackendProvider } from "@ANCIENT/agent";
import { decryptApiKey } from "../lib/connection-crypto";
import { guardJson } from "../lib/error-mapper";
import type { AuthenticatedEnv } from "../middleware/require-auth";

// One orchestrator for the whole process — see the scope note above.
const orchestrator = new TeamOrchestrator();

const ROLES: AgentRole[] = [
    "coordinator", "coder", "reviewer", "tester", "architect",
    "researcher", "debugger", "validator", "documenter",
];

function protocolToProvider(protocol: string): BackendProvider {
    switch (protocol) {
        case "anthropic": return "anthropic";
        case "openai": return "openai";
        case "gemini": return "google";
        default:
            // provider-connection-validation.ts's ConnectionProtocol is only
            // ever "openai" | "anthropic" | "gemini" today — this is a
            // deliberately loud failure if that ever changes, rather than
            // silently mis-routing a team's model calls.
            throw new Error(`Unmapped connection protocol: ${protocol}`);
    }
}

async function resolveConnection(userId: string, connectionId: string) {
    const connection = await db.providerConnection.findUnique({
        where: { id: connectionId, userId },
    });
    if (!connection) {
        throw new HTTPException(404, { message: `Provider connection ${connectionId} not found` });
    }
    const apiKey = await decryptApiKey(connection.encryptedKey);
    return {
        model: connection.modelId,
        provider: protocolToProvider(connection.protocol),
        apiKey,
        baseUrl: connection.baseUrl,
    };
}

const executeSchema = z.object({
    templateId: z.string(),
    task: z.string().min(1),
    defaultConnectionId: z.string(),
    connections: z.record(z.enum(ROLES as [AgentRole, ...AgentRole[]]), z.string()).optional(),
});

const app = new Hono<AuthenticatedEnv>()

    .get("/templates", (c) => {
        const category = c.req.query("category") ?? undefined;
        const templates = defaultRegistry.list(category).map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            category: t.category,
        }));
        return c.json(templates);
    })

    .post("/execute", zValidator("json", executeSchema), async (c) => {
        const userId = c.get("userId");
        const { templateId, task, defaultConnectionId, connections } = c.req.valid("json");

        const template = defaultRegistry.get(templateId);
        if (!template) return guardJson(c, `Unknown template: ${templateId}`, 404);

        // Decrypt each referenced connection once, then reuse the resolved
        // backend for every role that maps to it — not once per role, which
        // would mean re-decrypting the default connection up to nine times
        // for a template that only overrides one or two roles.
        const resolvedByConnectionId = new Map<string, Awaited<ReturnType<typeof resolveConnection>>>();
        async function resolved(connectionId: string) {
            const cached = resolvedByConnectionId.get(connectionId);
            if (cached) return cached;
            const backend = await resolveConnection(userId, connectionId);
            resolvedByConnectionId.set(connectionId, backend);
            return backend;
        }

        const defaultBackend = await resolved(defaultConnectionId);
        const overrides: ModelOverrides = {};
        for (const role of ROLES) {
            const connectionId = connections?.[role];
            overrides[role] = connectionId ? await resolved(connectionId) : defaultBackend;
        }

        const team = template.build(overrides);
        const { executionId, result } = orchestrator.startExecution(team, task);

        // Deliberately not awaited — the HTTP response returns the id
        // immediately; the run continues in the background and is polled
        // via GET /status. Errors are already captured into the returned
        // TaskResult by ArenaCoordinator, but log unexpected throws (a bug
        // in the coordinator itself, not a normal task failure) so they
        // don't disappear silently.
        result.catch((error) => {
            console.error(`Unhandled error in execution ${executionId}:`, error);
        });

        return c.json({ executionId, teamName: team.name, status: "running" }, 202);
    })

    .get("/status/:executionId", (c) => {
        const state = orchestrator.getExecutionStatus(c.req.param("executionId"));
        if (!state) return guardJson(c, "Execution not found", 404);
        return c.json({
            id: state.id,
            status: state.status,
            teamName: state.team.name,
            task: state.task,
            startedAt: state.startedAt,
            completedAt: state.completedAt,
        });
    })

    .post("/pause/:executionId", (c) => {
        const ok = orchestrator.pauseExecution(c.req.param("executionId"));
        if (!ok) return guardJson(c, "Execution not found or not running", 409);
        return c.json({ status: "paused" });
    })

    .post("/resume/:executionId", (c) => {
        const ok = orchestrator.resumeExecution(c.req.param("executionId"));
        if (!ok) return guardJson(c, "Execution not found or not paused", 409);
        return c.json({ status: "running" });
    })

    .post("/cancel/:executionId", (c) => {
        const ok = orchestrator.cancelExecution(c.req.param("executionId"));
        if (!ok) return guardJson(c, "Execution not found or already finished", 409);
        return c.json({ status: "cancelled" });
    });

export default app;
