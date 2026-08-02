import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@ANCIENT/database/client";
import { decryptApiKey, encryptApiKey } from "../lib/connection-crypto";
import { assertSafeBaseUrl } from "../lib/safe-url";
import {
    ProviderConnectionValidationError,
    validateProviderConnection,
} from "../lib/provider-connection-validation";
import type { AuthenticatedEnv } from "../middleware/require-auth";

const createConnectionSchema = z.object({
    label: z.string().trim().min(1).max(100),
    protocol: z.enum(["openai", "anthropic", "gemini"]),
    baseUrl: z.string().trim().url(),
    modelId: z.string().trim().min(1).max(200),
    apiKey: z.string(),
});

const app = new Hono<AuthenticatedEnv>()
    // POST /provider-connections – create a new custom connection
    .post("/", zValidator("json", createConnectionSchema), async (c) => {
        const userId = c.get("userId");
        const { label, protocol, baseUrl, modelId, apiKey } = c.req.valid("json");

        // SSRF guard – fails if baseUrl points to internal/private IP
        await assertSafeBaseUrl(baseUrl);

        try {
            await validateProviderConnection({ protocol, baseUrl, apiKey });
        } catch (error) {
            const message = error instanceof ProviderConnectionValidationError
                ? error.message
                : "Unable to validate the provider connection";
            return c.json({ error: message }, 422);
        }

        // Encrypt the API key before storing
        const encrypted = await encryptApiKey(apiKey);
        const keyLastFour = apiKey.length > 0 ? apiKey.slice(-4) : "local";

        const connection = await db.providerConnection.create({
            data: {
                userId,
                label,
                protocol,
                baseUrl,
                modelId,
                encryptedKey: encrypted,
                keyLastFour,
                isValid: true,
                lastValidatedAt: new Date(),
                lastValidationError: null,
            },
            select: {
                id: true,
                userId: true,
                label: true,
                protocol: true,
                baseUrl: true,
                modelId: true,
                keyLastFour: true,
                isValid: true,
                lastValidatedAt: true,
                lastValidationError: true,
                lastUsedAt: true,
                createdAt: true,
                // encryptedKey is intentionally omitted
            },
        });

        return c.json(connection, 201);
    })

    // GET /provider-connections – list all connections for the user
    .get("/", async (c) => {
        const userId = c.get("userId");

        const connections = await db.providerConnection.findMany({
            where: { userId },
            select: {
                id: true,
                userId: true,
                label: true,
                protocol: true,
                baseUrl: true,
                modelId: true,
                keyLastFour: true,
                isValid: true,
                lastValidatedAt: true,
                lastValidationError: true,
                lastUsedAt: true,
                createdAt: true,
            },
            orderBy: { createdAt: "desc" },
        });

        return c.json(connections);
    })

    // GET /provider-connections/:id – fetch a single connection (for status bar label)
    .get("/:id", async (c) => {
        const userId = c.get("userId");
        const id = c.req.param("id");

        const connection = await db.providerConnection.findUnique({
            where: { id, userId },
            select: {
                id: true,
                label: true,
                protocol: true,
                baseUrl: true,
                modelId: true,
                keyLastFour: true,
                createdAt: true,
            },
        });

        if (!connection) {
            return c.json({ error: "Connection not found" }, 404);
        }

        return c.json(connection);
    })

    // DELETE /provider-connections/:id – delete a connection
    .delete("/:id", async (c) => {
        const userId = c.get("userId");
        const id = c.req.param("id");

        const result = await db.providerConnection.deleteMany({
            where: { id, userId },
        });

        if (result.count === 0) {
            return c.json({ error: "Connection not found" }, 404);
        }

        return c.json({ success: true });
    });

export default app;
