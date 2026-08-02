// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@ANCIENT/database/client";
import type { AuthenticatedEnv } from "../middleware/require-auth";

const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  cwd: z.string().optional(),
});

const app = new Hono<AuthenticatedEnv>()
  .get("/", async (c) => {
    const userId = c.get("userId");
    const sessions = await db.session.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
    return c.json(sessions);
  })
  .post("/", zValidator("json", createSessionSchema), async (c) => {
    const userId = c.get("userId");
    const { title, cwd } = c.req.valid("json");
    const session = await db.session.create({
      data: { userId, title, cwd: cwd ?? null },
    });
    return c.json(session, 201);
  })
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const session = await db.session.findUnique({
      where: { id, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json(session);
  })
  .delete("/:id", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const result = await db.session.deleteMany({ where: { id, userId } });
    if (result.count === 0) return c.json({ error: "Session not found" }, 404);
    return c.json({ success: true });
  });

export default app;