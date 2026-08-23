/**
 * Agent System API Routes
 * 
 * REST API for team management, execution, and monitoring.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ExecutionEngine } from "@ANCIENT/agent";
import { TeamBuilder, defaultRegistry } from "@ANCIENT/agent/team";
import { requireAuth } from "../../middleware/require-auth";

const app = new Hono();
const engine = new ExecutionEngine();

// Middleware
app.use("*", requireAuth);

// ============================================================================
// Team Management
// ============================================================================

app.get("/teams", async (c) => {
    // Return all teams from database
    const teams = await c.env.prisma.agentTeam.findMany({
        include: { agents: true },
    });
    return c.json({ teams });
});

app.post("/teams", zValidator("json", z.object({
    name: z.string(),
    description: z.string().optional(),
    templateId: z.string().optional(),
    config: z.any().optional(), // TeamBuilder config
})), async (c) => {
    const body = c.req.valid("json");

    let team;
    if (body.templateId) {
        team = defaultRegistry.instantiate(body.templateId);
        if (!team) return c.json({ error: "Template not found" }, 404);
    } else if (body.config) {
        // Build from config
        team = body.config; // Would validate with TeamSchema
    } else {
        return c.json({ error: "Must provide templateId or config" }, 400);
    }

    // Persist to database
    const saved = await c.env.prisma.agentTeam.create({
        data: {
            name: team.name,
            description: team.description,
            coordinatorId: team.coordinatorId,
            protocol: JSON.stringify(team.protocol),
            maxParallelAgents: team.maxParallelAgents,
            sharedContext: team.sharedContext,
            checkpointEnabled: team.checkpointEnabled,
            fallbackStrategy: JSON.stringify(team.fallbackStrategy),
            agents: {
                create: team.agents.map(a => ({
                    name: a.name,
                    role: a.role,
                    description: a.description,
                    systemPrompt: a.systemPrompt,
                    capabilities: a.capabilities,
                    tools: a.tools,
                    backend: JSON.stringify(a.backend),
                    fallbackBackends: a.fallbackBackends.map(fb => JSON.stringify(fb)),
                    maxDelegationDepth: a.maxDelegationDepth,
                    canDelegateTo: a.canDelegateTo || [],
                    parentId: a.parentId,
                })),
            },
        },
        include: { agents: true },
    });

    return c.json({ team: saved }, 201);
});

app.get("/teams/:id", async (c) => {
    const team = await c.env.prisma.agentTeam.findUnique({
        where: { id: c.req.param("id") },
        include: { agents: true, executions: { take: 10, orderBy: { startedAt: "desc" } } },
    });
    if (!team) return c.json({ error: "Not found" }, 404);
    return c.json({ team });
});

// ============================================================================
// Execution
// ============================================================================

app.post("/execute", zValidator("json", z.object({
    teamId: z.string().uuid(),
    task: z.string().min(1),
    stream: z.boolean().default(false),
})), async (c) => {
    const { teamId, task, stream } = c.req.valid("json");

    const team = await c.env.prisma.agentTeam.findUnique({
        where: { id: teamId },
        include: { agents: true },
    });

    if (!team) return c.json({ error: "Team not found" }, 404);

    // Reconstruct TeamConfig from DB
    const teamConfig: any = {
        id: team.id,
        name: team.name,
        description: team.description,
        coordinatorId: team.coordinatorId,
        protocol: JSON.parse(team.protocol),
        maxParallelAgents: team.maxParallelAgents,
        sharedContext: team.sharedContext,
        checkpointEnabled: team.checkpointEnabled,
        fallbackStrategy: JSON.parse(team.fallbackStrategy),
        agents: team.agents.map((a: any) => ({
            id: a.id,
            name: a.name,
            role: a.role,
            description: a.description,
            systemPrompt: a.systemPrompt,
            capabilities: a.capabilities,
            tools: a.tools,
            backend: JSON.parse(a.backend),
            fallbackBackends: a.fallbackBackends.map((fb: string) => JSON.parse(fb)),
            maxDelegationDepth: a.maxDelegationDepth,
            canDelegateTo: a.canDelegateTo,
            parentId: a.parentId,
        })),
    };

    if (stream) {
        // SSE streaming
        c.header("Content-Type", "text/event-stream");
        c.header("Cache-Control", "no-cache");
        c.header("Connection", "keep-alive");

        const stream = new ReadableStream({
            async start(controller) {
                const result = await engine.executeWithStreaming(
                    teamConfig,
                    task,
                    (chunk) => {
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ chunk })}\\n\\n`));
                    }
                );
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ done: true, result })}\\n\\n`));
                controller.close();
            },
        });

        return c.body(stream);
    }

    const result = await engine.execute(teamConfig, task);
    return c.json({ result });
});

app.get("/execute/:id/status", async (c) => {
    const status = engine.getExecutionStatus(c.req.param("id"));
    if (!status) return c.json({ error: "Execution not found" }, 404);
    return c.json({ status });
});

app.post("/execute/:id/cancel", async (c) => {
    const success = engine.cancelExecution(c.req.param("id"));
    return c.json({ success });
});

// ============================================================================
// Templates
// ============================================================================

app.get("/templates", async (c) => {
    const templates = defaultRegistry.list();
    return c.json({ templates: templates.map(t => ({ id: t.id, name: t.name, description: t.description, category: t.category })) });
});

app.get("/templates/:id", async (c) => {
    const template = defaultRegistry.get(c.req.param("id"));
    if (!template) return c.json({ error: "Not found" }, 404);
    return c.json({ template: { id: template.id, name: template.name, description: template.description, category: template.category } });
});

export default app;