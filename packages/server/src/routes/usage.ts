// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { Hono } from "hono";
import { db } from "@ANCIENT/database/client";
import type { AuthenticatedEnv } from "../middleware/require-auth";

// Used only when a connection has never reported a quota window (e.g. no
// 429 has been seen yet), purely to give the "requests this window" count
// something to bucket against. This is a display fallback, not a claim
// about the provider's actual limit — `windowAssumed: true` marks it as such.
const DEFAULT_WINDOW_SECONDS = 86400;

type ConnectionUsage = {
    connectionId: string;
    label: string;
    modelId: string;
    used: number;
    limit: number | null;
    limitKnown: boolean;
    windowSeconds: number;
    windowAssumed: boolean;
    metric: string | null;
    resetAt: Date | null;
};

async function computeUsage(userId: string, connectionId: string): Promise<ConnectionUsage | null> {
    const connection = await db.providerConnection.findUnique({
        where: { id: connectionId, userId },
        select: {
            id: true,
            label: true,
            modelId: true,
            lastKnownQuotaLimit: true,
            lastKnownQuotaWindowSeconds: true,
            lastKnownQuotaResetAt: true,
            lastKnownQuotaMetric: true,
        },
    });
    if (!connection) return null;

    const windowAssumed = connection.lastKnownQuotaWindowSeconds == null;
    const windowSeconds = connection.lastKnownQuotaWindowSeconds ?? DEFAULT_WINDOW_SECONDS;
    const windowStart = new Date(Date.now() - windowSeconds * 1000);

    // Every completed turn (successful or errored) on this connection
    // corresponds to roughly one upstream request, so ASSISTANT + ERROR
    // rows in the window are a reasonable proxy for "requests used."
    const used = await db.message.count({
        where: {
            modelKind: "custom",
            modelRef: connectionId,
            createdAt: { gte: windowStart },
            role: { in: ["ASSISTANT", "ERROR"] },
        },
    });

    return {
        connectionId: connection.id,
        label: connection.label,
        modelId: connection.modelId,
        used,
        limit: connection.lastKnownQuotaLimit,
        limitKnown: connection.lastKnownQuotaLimit != null,
        windowSeconds,
        windowAssumed,
        metric: connection.lastKnownQuotaMetric,
        resetAt: connection.lastKnownQuotaResetAt,
    };
}

const app = new Hono<AuthenticatedEnv>()
    .get("/", async (c) => {
        const userId = c.get("userId");
        const connections = await db.providerConnection.findMany({
            where: { userId },
            select: { id: true },
            orderBy: { createdAt: "desc" },
        });

        const usages = (
            await Promise.all(connections.map((conn) => computeUsage(userId, conn.id)))
        ).filter((u): u is ConnectionUsage => u !== null);

        return c.json(usages);
    })

    .get("/:connectionId", async (c) => {
        const userId = c.get("userId");
        const usage = await computeUsage(userId, c.req.param("connectionId"));
        if (!usage) return c.json({ error: "Connection not found" }, 404);
        return c.json(usage);
    });

export default app;
