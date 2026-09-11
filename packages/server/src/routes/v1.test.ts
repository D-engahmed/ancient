import { describe, expect, it, afterEach } from "bun:test";
import { Hono } from "hono";
import { ExecutionEventBridge } from "../executions/bridge";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { createV1Routes, platformModelCatalog } from "./v1";
import { PLATFORM_API_USER } from "../middleware/require-api-key";
import type { ExecutionHub, ExecutionEntry } from "../executions/hub";
import { DEFAULT_CHAT_MODEL_ID } from "@ANCIENT/shared";

process.env.ANCIENT_PLATFORM_API_KEY = "test-platform-key";

afterEach(() => {
    process.env.ANCIENT_PLATFORM_API_KEY = "test-platform-key";
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
});

function buildEntry(executionId: string): ExecutionEntry {
    const bridge = new ExecutionEventBridge();
    bridge.start({ executionId, task: "platform task", mode: "BUILD" });
    return {
        executionId,
        userId: PLATFORM_API_USER,
        task: "platform task",
        mode: "BUILD",
        status: "running",
        session: { cancel: () => undefined, done: Promise.resolve({ status: "failed" }) },
        bridge,
    };
}

function buildApp(key: string) {
    const entry = buildEntry("PLATFORM-EXEC-1");
    const stubHub = {
        start: async () => entry,
        list: () => [entry],
        get: (_userId: string, id: string) => (id === entry.executionId ? entry : undefined),
        cancel: (_userId: string, id: string) => (id === entry.executionId ? { ...entry, status: "cancelled" } : undefined),
    } as unknown as ExecutionHub;

    const app = new Hono<AuthenticatedEnv>();
    app.use("*", async (c, next) => {
        c.set("traceId", "v1-test");
        await next();
    });
    app.route("/v1", createV1Routes(stubHub));

    async function request(path: string, init?: RequestInit) {
        return app.request(path, {
            ...init,
            headers: { Authorization: `Bearer ${key}`, ...init?.headers },
        });
    }
    return { request, entry };
}

describe("GET /v1/models", () => {
    it("rejects a missing or wrong API key with 401 AUTH_UNAUTHENTICATED", async () => {
        const { request } = buildApp("wrong-key");
        const res = await request("/v1/models", { headers: { Authorization: "Bearer wrong-key" } });
        expect(res.status).toBe(401);
        const body = (await res.json()) as { error?: { code?: string } };
        expect(body.error?.code).toBe("AUTH_UNAUTHENTICATED");
    });

    it("serves the platform model catalogue under a valid key", async () => {
        const { request } = buildApp("test-platform-key");
        const res = await request("/v1/models");
        expect(res.status).toBe(200);
        const body = (await res.json()) as { models: Array<{ id: string; provider: string; available: string }> };
        expect(body.models.length).toBeGreaterThan(0);
        expect(body.models.some((m) => m.id === DEFAULT_CHAT_MODEL_ID)).toBe(true);
    });

    it("marks a provider platform-available only when its env key is set", () => {
        process.env.OPENAI_API_KEY = "sk-openai";
        const models = platformModelCatalog();
        const gpt = models.find((m) => m.provider === "openai")!;
        expect(gpt.available).toBe("platform");
        const noKey = models.find((m) => m.provider === "anthropic")!;
        expect(noKey.available).toBe("unavailable");
        const local = models.find((m) => m.provider === "ollama")!;
        expect(local.available).toBe("byok");
    });
});

describe("/v1/executions surface", () => {
    it("starts an execution with the same body contract as the interactive route", async () => {
        const { request } = buildApp("test-platform-key");
        const res = await request("/v1/executions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task: "platform task", mode: "BUILD" }),
        });
        expect(res.status).toBe(202);
        const body = (await res.json()) as { executionId: string };
        expect(body.executionId).toBe("PLATFORM-EXEC-1");
    });

    it("cancels an execution under the platform key", async () => {
        const { request } = buildApp("test-platform-key");
        const res = await request("/v1/executions/PLATFORM-EXEC-1/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string };
        expect(body.status).toBe("cancelled");
    });

    it("lists executions under the subject user (not the caller identity)", async () => {
        const { request } = buildApp("test-platform-key");
        const res = await request("/v1/executions");
        expect(res.status).toBe(200);
        const body = (await res.json()) as { executions: Array<{ executionId: string }> };
        expect(body.executions).toHaveLength(1);
        expect(body.executions[0]!.executionId).toBe("PLATFORM-EXEC-1");
    });
});