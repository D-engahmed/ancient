// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Capability core tests (capabilities/core). 14 tests.

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { Mode } from "@ANCIENT/shared";
import { ApprovalPolicy, Redactor } from "@ANCIENT/infrastructure/security";

import { toToolSet } from "./adapters";
import { executeTool } from "./execute";
import { CapabilityRegistry } from "./registry";
import type { ExecutionScope, ToolDefinition } from "./types";
import { capResultLength, serializeResult } from "./types";

const scope: ExecutionScope = { cwd: "/work", homedir: "/home" };

const readTool: ToolDefinition = {
    name: "readFile",
    description: "Read a file",
    inputSchema: z.object({ path: z.string() }),
    category: "read",
    target: (a) => (a as { path: string }).path,
    execute: async (_s, args) => `contents of ${(args as { path: string }).path}`,
};

const writeTool: ToolDefinition = {
    name: "writeFile",
    description: "Write a file",
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    category: "write",
    modes: [Mode.BUILD],
    target: (a) => (a as { path: string }).path,
    execute: async () => "ok",
};

const execTool: ToolDefinition = {
    name: "bash",
    description: "Run a command",
    inputSchema: z.object({ command: z.string() }),
    category: "exec",
    target: (a) => (a as { command: string }).command,
    execute: async (_s, args) => `ran ${(args as { command: string }).command}`,
};

describe("CapabilityRegistry", () => {
    it("registers and lists tools in order", () => {
        const r = new CapabilityRegistry();
        r.registerAll([readTool, writeTool]);
        expect(r.listNames()).toEqual(["readFile", "writeFile"]);
        expect(r.get("readFile")?.category).toBe("read");
        expect(r.has("bash")).toBe(false);
    });

    it("keeps the first registration on duplicate names", () => {
        const r = new CapabilityRegistry();
        r.register(readTool);
        const a = new CapabilityRegistry();
        a.register({ ...readTool });
        r.registerAll([a.get("readFile") as ToolDefinition]);
        expect(r.list().length).toBe(1);
    });

    it("filters write tools out of PLAN mode", () => {
        const r = new CapabilityRegistry().registerAll([readTool, writeTool, execTool]);
        expect(r.listFor(Mode.BUILD).map((t) => t.name)).toEqual([
            "readFile",
            "writeFile",
            "bash",
        ]);
        expect(r.listFor(Mode.PLAN).map((t) => t.name)).toEqual(["readFile"]);
    });

    it("applies an allow-list by name", () => {
        const r = new CapabilityRegistry().registerAll([readTool, writeTool]);
        expect(r.listFor(Mode.BUILD, ["readFile"]).map((t) => t.name)).toEqual(["readFile"]);
    });
});

describe("executeTool — central policy edge", () => {
    const defaultPolicy = new ApprovalPolicy();

    it("runs an allowed read tool and returns serialized output", async () => {
        const res = await executeTool(readTool, scope, { path: "a.txt" }, { policy: defaultPolicy });
        expect(res.ok).toBe(true);
        expect(res.output).toBe("contents of a.txt");
        expect(res.truncated).toBe(false);
    });

    it("denies exec by default (unapproved category)", async () => {
        const res = await executeTool(execTool, scope, { command: "rm -rf /" }, { policy: defaultPolicy });
        expect(res.ok).toBe(false);
        expect(res.error).toContain("denied");
    });

    it("requires consent for a scope-level write and blocks without a provider", async () => {
        const policy = new ApprovalPolicy([
            { category: "write", decision: "require-consent" },
        ]);
        const res = await executeTool(writeTool, scope, { path: "x", content: "y" }, { policy });
        expect(res.ok).toBe(false);
        expect(res.error).toContain("consent not granted");
    });

    it("executes a require-consent tool once consent is granted", async () => {
        const policy = new ApprovalPolicy([{ category: "write", decision: "require-consent" }]);
        const res = await executeTool(
            writeTool,
            scope,
            { path: "x", content: "y" },
            {
                policy,
                consentProvider: (req) => req.toolName === "writeFile",
            },
        );
        expect(res.ok).toBe(true);
        expect(res.approval).toContain("consent required");
    });

    it("rejects invalid arguments with an args-invalid result", async () => {
        const res = await executeTool(readTool, scope, { nope: 1 }, { policy: defaultPolicy });
        expect(res.ok).toBe(false);
        expect(res.approval).toBe("args-invalid");
    });

    it("caps output to the tool budget and flags truncation", async () => {
        const big = { ...readTool, maxResultChars: 10 };
        const res = await executeTool(big, scope, { path: "a" }, { policy: defaultPolicy });
        expect(res.ok).toBe(true);
        expect(res.truncated).toBe(true);
        expect(res.output.length).toBeLessThanOrEqual(10);
    });

    it("redacts secrets out of tool output", async () => {
        const leaky: ToolDefinition = {
            ...readTool,
            execute: async () => "token=sk-abcdefghijklmnopqrstuvwx",
        };
        const res = await executeTool(leaky, scope, { path: "a" }, {
            policy: defaultPolicy,
            redactor: new Redactor(),
        });
        expect(res.ok).toBe(true);
        expect(res.output).not.toContain("sk-abcdefghijklmnopqrstuvwx");
        expect(res.redacted).toContain("sk");
    });

    it("does not swallow executor errors — returns ok:false with the message", async () => {
        const boom: ToolDefinition = {
            ...readTool,
            execute: async () => {
                throw new Error("disk full");
            },
        };
        const res = await executeTool(boom, scope, { path: "a" }, { policy: defaultPolicy });
        expect(res.ok).toBe(false);
        expect(res.error).toContain("disk full");
    });
});

describe("helpers", () => {
    it("serializeResult handles strings vs structured values", () => {
        expect(serializeResult("plain")).toBe("plain");
        expect(serializeResult({ a: 1 })).toBe('{"a":1}');
        expect(serializeResult(undefined)).toBe("");
    });

    it("capResultLength truncates and reports", () => {
        const r = capResultLength("0123456789", 5);
        expect(r.text).toBe("01234");
        expect(r.truncated).toBe(true);
        expect(capResultLength("ok", 5).truncated).toBe(false);
    });
});

describe("toToolSet (AI-SDK adapter)", () => {
    it("produces sdk tools for the mode-gated slice", async () => {
        const r = new CapabilityRegistry().registerAll([readTool, writeTool]);
        const sdk = toToolSet(r, { mode: Mode.BUILD, scope, policy: new ApprovalPolicy() });
        expect(Object.keys(sdk)).toEqual(["readFile", "writeFile"]);
        expect(typeof sdk.readFile!.execute).toBe("function");
    });

    it("throws on a denied call so the model can recover", async () => {
        const r = new CapabilityRegistry().register(execTool);
        const sdk = toToolSet(r, { scope, policy: new ApprovalPolicy() });
        const slotted = sdk as unknown as Record<string, { execute: (a: unknown) => Promise<string> }>;
        await expect(slotted.bash!.execute({ command: "rm -rf /" })).rejects.toThrow(/denied/);
    });

    it("returns the redacted serialized output on success", async () => {
        const r = new CapabilityRegistry().register(readTool);
        const sdk = toToolSet(r, { scope, policy: new ApprovalPolicy() });
        const slotted = sdk as unknown as Record<string, { execute: (a: unknown) => Promise<string> }>;
        const out = await slotted.readFile!.execute({ path: "a" });
        expect(out).toBe("contents of a");
    });
});