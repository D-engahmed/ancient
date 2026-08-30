// file: packages/server/src/routes/extensions.ts
// REST endpoints for the extension systems: skills, subagents, slash
// commands, MCP servers, compaction, and checkpoints/rewind.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { generateText } from "ai";
import { db } from "@ANCIENT/database/client";
import { MessageStatus } from "@ANCIENT/database/enums";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { listSkills, loadSkill } from "../skills/loader";
import { listAgents } from "../agents/loader";
import { listCommands } from "../commands/loader";
import { listMcpServers, resetMcpCache } from "../mcp/client";
import { loadSettings } from "../hooks/settings";
import { listCheckpoints, rewindTo } from "../checkpoints/store";
import { resolveFreeModel, resolveChatModel } from "../lib/models";
import { guardJson } from "../lib/error-mapper";
import type { ChatModelSelection } from "@ANCIENT/shared";
import { SUMMARY_MARKER } from "./chat";
import { createLogger } from "@ANCIENT/shared";

const log = createLogger("extensions");

const COMPACT_TRANSCRIPT_CHARS = 40_000;

const app = new Hono<AuthenticatedEnv>();

// ---- Listings (cwd passed as query param; optional) ----

app.get("/skills", async (c) => {
    const cwd = c.req.query("cwd") || null;
    const skills = await listSkills(cwd);
    return c.json(skills.map(({ dir, ...meta }) => ({ ...meta, dir })));
});

app.get("/skills/:name", async (c) => {
    const cwd = c.req.query("cwd") || null;
    const skill = await loadSkill(cwd, c.req.param("name"));
    if (!skill) return guardJson(c, "Skill not found", 404);
    return c.json(skill);
});

app.get("/agents", async (c) => {
    const cwd = c.req.query("cwd") || null;
    return c.json(await listAgents(cwd));
});

app.get("/commands", async (c) => {
    const cwd = c.req.query("cwd") || null;
    return c.json(await listCommands(cwd));
});

app.get("/mcp", async (c) => {
    const cwd = c.req.query("cwd") || null;
    const settings = await loadSettings(cwd);
    if (settings.mcp?.enabled === false) return c.json([]);
    return c.json(await listMcpServers(cwd));
});

app.post("/mcp/reload", async (c) => {
    resetMcpCache();
    return c.json({ success: true });
});

app.get("/settings", async (c) => {
    const cwd = c.req.query("cwd") || null;
    return c.json(await loadSettings(cwd));
});

// ---- /compact — summarize history into a context-summary message ----

app.post("/compact/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const userId = c.get("userId");

    const session = await db.session.findUnique({
        where: { id: sessionId, userId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!session) return guardJson(c, "Session not found", 404);
    if (session.messages.length < 4) {
        return guardJson(c, "Session is too short to compact", 409);
    }

    // Transcript, capped — compaction input should itself be cheap.
    const transcript = session.messages
        .filter((m) => m.role !== "ERROR" && !m.content.startsWith(SUMMARY_MARKER))
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n\n")
        .slice(-COMPACT_TRANSCRIPT_CHARS);

    // Prefer the configured free model for summarization; fall back to the
    // model the session was already using.
    let model;
    let usedModel: string;
    const settings = await loadSettings(session.cwd);
    const free = resolveFreeModel(settings.modelRouting?.freeModel);
    if (free) {
        model = free.model;
        usedModel = free.modelId;
    } else {
        const last = [...session.messages].reverse().find((m) => m.modelRef);
        if (!last) return guardJson(c, "No model available to summarize with", 409);
        const selection: ChatModelSelection = last.modelKind === "builtin"
            ? { modelKind: "builtin", modelId: last.modelRef }
            : { modelKind: "custom", connectionId: last.modelRef };
        try {
            const resolved = await resolveChatModel(selection, userId);
            model = resolved.model;
            usedModel = resolved.modelId;
        } catch (err) {
            return guardJson(c, err instanceof Error ? err.message : String(err), 409);
        }
    }

    try {
        const result = await generateText({
            model,
            system: "You compress AI coding-assistant conversations. Preserve everything the assistant still needs to continue working: decisions made, files read/modified, commands run and their outcomes, errors hit, and the current task state. Be dense and factual; drop chit-chat.",
            prompt: `Summarize this conversation into a compact context brief (max 600 words):\n\n${transcript}`,
        });

        await db.message.create({
            data: {
                sessionId,
                role: "USER",
                status: MessageStatus.COMPLETE,
                modelKind: "builtin",
                modelRef: `compact:${usedModel}`,
                content: `${SUMMARY_MARKER}\n${result.text.trim()}\n</ancient-context-summary>\n\n(Conversation compacted — the summary above replaces all earlier messages. Continue from here.)`,
                mode: session.messages.at(-1)?.mode ?? "BUILD",
            },
        });

        return c.json({ success: true, summarizedMessages: session.messages.length, model: usedModel });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("compact failed", { sessionId, error: msg });
        return guardJson(c, `Compaction failed: ${msg}`, 500);
    }
});

// ---- Checkpoints & rewind ----

app.get("/checkpoints/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const userId = c.get("userId");
    const session = await db.session.findUnique({ where: { id: sessionId, userId } });
    if (!session) return guardJson(c, "Session not found", 404);
    if (!session.cwd) return c.json([]);
    return c.json(await listCheckpoints(session.cwd, sessionId));
});

app.post(
    "/rewind/:sessionId",
    zValidator("json", z.object({ checkpointId: z.string().min(1) })),
    async (c) => {
        const sessionId = c.req.param("sessionId");
        const userId = c.get("userId");
        const { checkpointId } = c.req.valid("json");

        const session = await db.session.findUnique({ where: { id: sessionId, userId } });
        if (!session) return guardJson(c, "Session not found", 404);
        if (!session.cwd) return guardJson(c, "Session has no working directory", 409);

        const checkpoints = await listCheckpoints(session.cwd, sessionId);
        const target = checkpoints.find((cp) => cp.id === checkpointId || cp.id.startsWith(checkpointId));
        if (!target) return guardJson(c, `Unknown checkpoint: ${checkpointId}`, 404);

        // 1. Restore files.
        const restored = await rewindTo(session.cwd, target.id);
        if (!restored.ok) return guardJson(c, restored.error ?? "Rewind failed", 500);

        // 2. Delete conversation messages created after the checkpoint.
        const deleted = await db.message.deleteMany({
            where: {
                sessionId,
                createdAt: { gt: new Date(target.createdAt) },
            },
        });

        return c.json({ success: true, checkpoint: target, deletedMessages: deleted.count });
    },
);

export default app;
