// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Engine runtime tests (engine) — the StrategyRuntime over a real capability
// registry walks the central edge (approval/consent/budget/redaction).

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { CapabilityRegistry } from "@ANCIENT/capabilities/core";
import { ApprovalPolicy } from "@ANCIENT/infrastructure/security";
import { createStrategyRuntime } from "./runtime";
import type { ModelChat } from "./types";

function fixture(): CapabilityRegistry {
    return new CapabilityRegistry()
        .register({
            name: "readFile",
            description: "Read a file.",
            inputSchema: z.object({ path: z.string() }),
            category: "read",
            execute: async (_scope, args) => `content of ${(args as { path: string }).path}`,
        })
        .register({
            name: "writeFile",
            description: "Write a file.",
            inputSchema: z.object({ path: z.string(), content: z.string() }),
            category: "write",
            execute: async (_scope, args) => `wrote ${(args as { path: string }).path}`,
        })
        .register({
            name: "bash",
            description: "Run a shell command.",
            inputSchema: z.object({ command: z.string() }),
            category: "exec",
            execute: async () => "ran",
        })
        .register({
            name: "connectVault",
            description: "Connect a vault.",
            inputSchema: z.object({ vaultId: z.string() }),
            category: "scope",
            execute: async () => "connected",
        });
}

const silentModel: ModelChat = async () => ({ text: "unused", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } });

describe("createStrategyRuntime", () => {
    const registry = fixture();
    const scope = { cwd: process.cwd() };

    it("lists mode-gated tools as RuntimeTools with zod schemas", async () => {
        const rt = createStrategyRuntime({ registry, scope, model: silentModel, policy: new ApprovalPolicy() });
        const tools = await rt.listTools();
        expect(tools.map((t) => t.name)).toEqual(["readFile", "writeFile", "bash", "connectVault"]);
        expect(tools[0]).toMatchObject({ name: "readFile", description: "Read a file." });
        expect(tools[0]?.inputSchema.parse({ path: "a" })).toEqual({ path: "a" });
    });

    it("drops non-read tools in PLAN mode and honors an allow-list", async () => {
        const rt = createStrategyRuntime({
            registry,
            scope,
            model: silentModel,
            policy: new ApprovalPolicy(),
            mode: "PLAN",
            allow: ["readFile", "writeFile"],
        });
        const tools = await rt.listTools();
        expect(tools.map((t) => t.name)).toEqual(["readFile"]);
    });

    it("executes an allowed read call and returns the serialized result", async () => {
        const rt = createStrategyRuntime({ registry, scope, model: silentModel, policy: new ApprovalPolicy() });
        const res = await rt.executeTool({ id: "1", name: "readFile", args: { path: "x.ts" } });
        expect(res.ok).toBe(true);
        expect(res.text).toBe("content of x.ts");
    });

    it("denies exec/write under the default policy without throwing", async () => {
        const rt = createStrategyRuntime({ registry, scope, model: silentModel, policy: new ApprovalPolicy() });
        const bash = await rt.executeTool({ id: "2", name: "bash", args: { command: "id" } });
        expect(bash.ok).toBe(false);
        expect(bash.failure?.code).toBe("POLICY_DENIED");
        expect(bash.text).toContain("error: bash: denied");
        const write = await rt.executeTool({ id: "3", name: "writeFile", args: { path: "a", content: "b" } });
        expect(write.ok).toBe(false);
        expect(write.failure?.code).toBe("POLICY_DENIED");
        expect(write.text).toContain("error: writeFile: denied");
    });

    it("grants require-consent calls through the consent provider", async () => {
        const rt = createStrategyRuntime({
            registry,
            scope,
            model: silentModel,
            policy: new ApprovalPolicy(),
            consentProvider: ({ toolName }) => toolName === "connectVault",
        });
        const res = await rt.executeTool({ id: "4", name: "connectVault", args: { vaultId: "v-1" } });
        expect(res.ok).toBe(true);
        expect(res.text).toBe("connected");
    });

    it("returns an error for unknown tools", async () => {
        const rt = createStrategyRuntime({ registry, scope, model: silentModel, policy: new ApprovalPolicy() });
        const res = await rt.executeTool({ id: "5", name: "doesNotExist", args: {} });
        expect(res.ok).toBe(false);
        expect(res.failure?.code).toBe("CAPABILITY_EXECUTION_FAILED");
        expect(res.text).toContain("error: unknown tool");
    });

    it("delegates runModel to the injected chat port", async () => {
        const spin = async (): Promise<{ text: string; toolCalls: never[] }> => ({ text: "hi", toolCalls: [] });
        const rt = createStrategyRuntime({ registry, scope, model: spin as unknown as ModelChat, policy: new ApprovalPolicy() });
        expect((await rt.runModel({ prompt: "p" })).text).toBe("hi");
    });
});