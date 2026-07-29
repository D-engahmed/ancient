import { Hono } from "hono";
// import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@ANCIENT/database/client";

import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";


const createSessionSchema = z.object({
  title: z.string(),
});

const createSessionValidator = zValidator(
  "json", createSessionSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

const app = new Hono<AuthenticatedEnv>()
  .get("/", async (c) => {
    const userId = c.get("userId");

    const sessions = await db.session.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
      },
    });

    return c.json(sessions);
  })
  .get("/:id", async (c) => {
    // MOCK: Uncomment to simulate slow session loading
    // await new Promise((r) => setTimeout(r, 5000))

    // MOCK: Uncomment to simulate session loading error
    // throw new HTTPException(
    //   500, 
    //   { message: "Mock error: session loading failed" }
    // )

    const id = c.req.param("id");
    const userId = c.get("userId");

    const session = await db.session.findUnique({
      where: { id, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json(session);
  })
  .post("/", requireCreditsBalance, createSessionValidator, async (c) => {
    // MOCK: Uncomment to simulate slow session loading
    // await new Promise((r) => setTimeout(r, 5000))

    // MOCK: Uncomment to simulate session loading error
    // throw new HTTPException(
    //   500, 
    //   { message: "Mock error: session loading failed" }
    // )

    const userId = c.get("userId");
    const data = c.req.valid("json");

    const session = await db.session.create({
      data: {
        ...data,
        userId,
      },
    });

    return c.json(session, 201);
  });

export default app;
