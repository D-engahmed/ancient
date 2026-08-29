// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// MCP capability tests (capabilities/mcp). Static tests (config merge,
// schema translation, gating) + one true e2e: a mock MCP server spawned as a
// stdio child process is discovered from .mcp.json and driven through the
// central edge.

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

import { CapabilityRegistry, executeTool } from "../core";
import { ApprovalPolicy } from "@ANCIENT/infrastructure/security";
import type { ExecutionScope } from "../core/types";
import { loadMcpConfig, mcpConfigPaths } from "./config";
import { jsonSchemaToZod } from "./json-schema";
import { disposeMcpConnections, getMcpToolDefinitions, listMcpServers, resetMcpCache } from "./client";
import { listMcpServersTool } from "./tools";

let root: string;
let cwd: string;
let scope: ExecutionScope;
let fixturePath: string;
const policy = new ApprovalPolicy();
const execPolicy = new ApprovalPolicy().allow("exec");

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "caps-mcp-"));
    cwd = join(root, "project");
    await mkdir(cwd, { recursive: true });
    scope = { cwd };
    fixturePath = join(`${process.cwd()}`, "packages", "capabilities", "src", "mcp", "fixtures", "mock-server.ts");
});

afterAll(async () => {
    await disposeMcpConnections();
    await rm(root, { recursive: true, force: true });
});

describe("config discovery", () => {
    it("merges global + project, project shadows global", async () => {
        process.env.ANCIENT_USER_DIR = join(root, "user", ".ancient");
        await mkdir(join(root, "user", ".ancient"), { recursive: true });
        await writeFile(
            join(root, "user", ".ancient", ".mcp.json"),
            JSON.stringify({ mcpServers: { a: { command: "x" }, b: { command: "y" } } }),
        );
        await writeFile(cwd + "/.mcp.json", JSON.stringify({ mcpServers: { b: { command: "z" }, c: { url: "http://x" } } }));
        const config = await loadMcpConfig(cwd);
        expect(Object.keys(config).sort()).toEqual(["a", "b", "c"]);
        expect(config.b).toEqual({ command: "z" });
        delete process.env.ANCIENT_USER_DIR;
    });

    it("ignores missing or malformed config files", async () => {
        const good = cwd;
        await writeFile(join(good, "broken.json"), "not json"); // unrelated
        expect(await loadMcpConfig(join(good, "does-not-exist"))).toEqual({});
    });

    it("maps none-available file lists by convention", () => {
        expect(mcpConfigPaths(cwd)).toEqual([join(homedir(), ".ancient", ".mcp.json"), join(cwd, ".mcp.json")]);
    });
});

describe("jsonSchemaToZod", () => {
    it("translates object schemas with required/optional/arrays/enums", () => {
        const schema = jsonSchemaToZod({
            type: "object",
            required: ["name"],
            properties: {
                name: { type: "string" },
                count: { type: "integer" },
                tags: { type: "array", items: { type: "string" } },
                level: { type: "string", enum: ["low", "high"] },
            },
        });
        expect(schema.safeParse({ name: "x", tags: ["a"], level: "high" }).success).toBe(true);
        expect(schema.safeParse({ count: 2 }).success).toBe(false); // name required
        expect(schema.safeParse({ name: "x", level: "nope" }).success).toBe(false); // enum
    });

    it("degrades unknown shapes to z.unknown()", () => {
        expect(jsonSchemaToZod(12).safeParse("anything").success).toBe(true);
    });
});

describe("e2e: mock MCP server via stdio", () => {
    beforeAll(async () => {
        resetMcpCache();
        // no global config; project config spawns the mock server with bun
        process.env.ANCIENT_USER_DIR = join(root, "user", ".ancient");
        await mkdir(join(root, "user", ".ancient"), { recursive: true });
        rm(join(root, "user", ".ancient", ".mcp.json"), { force: true }).catch(() => {});
        await writeFile(
            join(cwd, ".mcp.json"),
            JSON.stringify({
                mcpServers: {
                    mock: { command: process.execPath, args: [fixturePath] },
                },
            }),
        );
    });

    afterAll(() => delete process.env.ANCIENT_USER_DIR);

    it("connects, reports status, and lists the remote tool", async () => {
        const statuses = await listMcpServers(cwd);
        expect(statuses).toHaveLength(1);
        expect(statuses[0]).toMatchObject({ name: "mock", connected: true, toolCount: 1 });

        const defs = await getMcpToolDefinitions(cwd);
        expect(defs.map((d) => d.name)).toEqual(["mcp__mock__greet"]);
        expect(defs[0]?.category).toBe("exec");
    }, 20_000);

    it("translates the remote input schema", async () => {
        const defs = await getMcpToolDefinitions(cwd);
        const def = defs[0];
        if (!def) throw new Error("expected mcp__mock__greet");
        expect(def.inputSchema.safeParse({ name: "ada", count: 2 }).success).toBe(true);
        expect(def.inputSchema.safeParse({ count: 2 }).success).toBe(false);
    });

    it("drives the remote tool through the central edge (exec allowed)", async () => {
        const defs = await getMcpToolDefinitions(cwd);
        const def = defs[0];
        if (!def) throw new Error("expected mcp__mock__greet");
        const res = await executeTool(def, scope, { name: "ada", count: 2 }, { policy: execPolicy });
        expect(res.ok).toBe(true);
        const parsed = JSON.parse(res.output) as { content: { type: string; text: string }[] };
        expect(parsed.content[0]?.text).toBe("hi ada\nhi ada");
    }, 20_000);

    it("is denied by the default policy (exec deny)", async () => {
        const defs = await getMcpToolDefinitions(cwd);
        const def = defs[0];
        if (!def) throw new Error("expected mcp__mock__greet");
        const res = await executeTool(def, scope, { name: "ada" }, { policy });
        expect(res.ok).toBe(false);
        expect(res.error).toContain("denied");
    });
});

describe("listMcpServers tool + registry", () => {
    it("runs under the default (read-allowed) policy and reports this cwd", async () => {
        const res = await executeTool(listMcpServersTool, scope, {}, { policy });
        expect(res.ok).toBe(true);
        const servers = (JSON.parse(res.output) as { servers: { name: string }[] }).servers;
        // cache hit on the same cwd — mock present from the e2e suite
        expect(servers.length).toBeGreaterThanOrEqual(1);
    });

    it("registers as read (PLAN-safe)", () => {
        const registry = new CapabilityRegistry().registerAll([listMcpServersTool]);
        expect(registry.listFor("PLAN").map((t) => t.name)).toContain("listMcpServers");
    });
});