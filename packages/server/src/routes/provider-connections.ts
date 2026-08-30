// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

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
import { errorJson, gatewayError, guardJson } from "../lib/error-mapper";
import type { AuthenticatedEnv } from "../middleware/require-auth";

/** 422 for a failed connection validation: envelope + the refreshed row. */
function validationFailedJson(c: any, message: string, connection: unknown) {
    return c.json(
        { error: gatewayError(message, 422, String(c.get("traceId"))).error, connection },
        422 as const,
    );
}

const createConnectionSchema = z.object({
    label: z.string().trim().min(1).max(100),
    protocol: z.enum(["openai", "anthropic", "gemini"]),
    baseUrl: z.string().trim().url(),
    modelId: z.string().trim().min(1).max(200),
    apiKey: z.string(),
});

const updateConnectionSchema = z.object({
    label: z.string().trim().min(1).max(100).optional(),
    protocol: z.enum(["openai", "anthropic", "gemini"]).optional(),
    baseUrl: z.string().trim().url().optional(),
    modelId: z.string().trim().min(1).max(200).optional(),
    apiKey: z.string().optional(),
}).refine((input) => Object.keys(input).length > 0, {
    message: "Provide at least one connection field to update",
});

const connectionSelect = {
    id: true, userId: true, label: true, protocol: true, baseUrl: true, modelId: true,
    keyLastFour: true, isValid: true, lastValidatedAt: true, lastValidationError: true,
    lastUsedAt: true, createdAt: true,
} as const;

const app = new Hono<AuthenticatedEnv>()
    .post("/", zValidator("json", createConnectionSchema), async (c) => {
        const userId = c.get("userId");
        const { label, protocol, baseUrl, modelId, apiKey } = c.req.valid("json");

        await assertSafeBaseUrl(baseUrl);

        try {
            await validateProviderConnection({ protocol, baseUrl, apiKey, modelId });
        } catch (error) {
            if (error instanceof ProviderConnectionValidationError) return errorJson(c, error, 422);
            return guardJson(c, "Unable to validate the provider connection", 422);
        }

        const encrypted = await encryptApiKey(apiKey);
        const keyLastFour = apiKey.length >= 4 ? apiKey.slice(-4) : apiKey.length > 0 ? apiKey : "empty";

        const connection = await db.providerConnection.create({
            data: {
                userId, label, protocol, baseUrl, modelId,
                encryptedKey: encrypted, keyLastFour,
                isValid: true, lastValidatedAt: new Date(), lastValidationError: null,
            },
            select: connectionSelect,
        });

        return c.json(connection, 201);
    })

    .get("/", async (c) => {
        const userId = c.get("userId");
        const connections = await db.providerConnection.findMany({
            where: { userId },
            select: connectionSelect,
            orderBy: { createdAt: "desc" },
        });
        return c.json(connections);
    })

    .post("/:id/validate", async (c) => {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const connection = await db.providerConnection.findUnique({ where: { id, userId } });
        if (!connection) return guardJson(c, "Connection not found", 404);

        try {
            await assertSafeBaseUrl(connection.baseUrl);
            const apiKey = await decryptApiKey(connection.encryptedKey);
            await validateProviderConnection({
                protocol: connection.protocol as "openai" | "anthropic" | "gemini",
                baseUrl: connection.baseUrl,
                apiKey,
                modelId: connection.modelId,
            });
            const updated = await db.providerConnection.update({
                where: { id },
                data: { isValid: true, lastValidatedAt: new Date(), lastValidationError: null },
                select: connectionSelect,
            });
            return c.json(updated);
        } catch (error) {
            const message = error instanceof ProviderConnectionValidationError
                ? error.message
                : "Unable to validate the provider connection";
            const updated = await db.providerConnection.update({
                where: { id },
                data: { isValid: false, lastValidatedAt: new Date(), lastValidationError: message },
                select: connectionSelect,
            });
            return validationFailedJson(c, message, updated);
        }
    })

    .patch("/:id", zValidator("json", updateConnectionSchema), async (c) => {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const current = await db.providerConnection.findUnique({ where: { id, userId } });
        if (!current) return guardJson(c, "Connection not found", 404);

        const input = c.req.valid("json");
        const protocol = input.protocol ?? (current.protocol as "openai" | "anthropic" | "gemini");
        const baseUrl = input.baseUrl ?? current.baseUrl;
        const apiKey = input.apiKey ?? await decryptApiKey(current.encryptedKey);
        const modelId = input.modelId ?? current.modelId;

        try {
            await assertSafeBaseUrl(baseUrl);
            await validateProviderConnection({ protocol, baseUrl, apiKey, modelId });
        } catch (error) {
            if (error instanceof ProviderConnectionValidationError) return errorJson(c, error, 422);
            return guardJson(c, "Unable to validate the provider connection", 422);
        }

        const updateData: any = {
            label: input.label ?? current.label,
            protocol, baseUrl,
            modelId: input.modelId ?? current.modelId,
            isValid: true, lastValidatedAt: new Date(), lastValidationError: null,
        };

        if (input.apiKey !== undefined) {
            updateData.encryptedKey = await encryptApiKey(apiKey);
            updateData.keyLastFour = apiKey.length >= 4 ? apiKey.slice(-4) : apiKey.length > 0 ? apiKey : "empty";
        }

        const updated = await db.providerConnection.update({
            where: { id }, data: updateData, select: connectionSelect,
        });
        return c.json(updated);
    })

    .get("/:id", async (c) => {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const connection = await db.providerConnection.findUnique({
            where: { id, userId },
            select: { id: true, label: true, protocol: true, baseUrl: true, modelId: true, keyLastFour: true, createdAt: true },
        });
        if (!connection) return guardJson(c, "Connection not found", 404);
        return c.json(connection);
    })

    .delete("/:id", async (c) => {
        const userId = c.get("userId");
        const id = c.req.param("id");
        const result = await db.providerConnection.deleteMany({ where: { id, userId } });
        if (result.count === 0) return guardJson(c, "Connection not found", 404);
        return c.json({ success: true });
    });

export default app;