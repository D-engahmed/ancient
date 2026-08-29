// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Shell capability tests (capabilities/shell). 11 tests.

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CapabilityRegistry, executeTool } from "../core";
import { ApprovalPolicy } from "@ANCIENT/infrastructure/security";
import type { ExecutionScope } from "../core/types";
import { bashTool, shellCapability } from "./tools";
import { findDangerousCommandMatch } from "./dangerous-commands";

let dir: string;
let scope: ExecutionScope;
const execPolicy = new ApprovalPolicy().allow("exec");

const sleepCmd = process.platform === "win32" ? "ping -n 2 127.0.0.1 > nul" : "sleep 0.2";
const exitCmd = `node -e "process.exit(3)"`;

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "caps-shell-"));
    scope = { cwd: dir };
});

afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe("dangerous-commands denylist", () => {
    it("blocks irreversible destructive one-liners", () => {
        expect(findDangerousCommandMatch("rm -rf /")).toContain("root");
        expect(findDangerousCommandMatch("rm -rf ~")).toContain("home");
        expect(findDangerousCommandMatch("git push --force origin main")).toContain("force-push");
        expect(findDangerousCommandMatch("git reset --hard HEAD~1")).toContain("hard reset");
        expect(findDangerousCommandMatch("mkfs.ext4 /dev/sda1")).toContain("filesystem");
        expect(findDangerousCommandMatch("dd if=x of=/dev/sda bs=1M")).toContain("block device");
        expect(findDangerousCommandMatch(":(){ :|:& };:")).toContain("fork bomb");
        expect(findDangerousCommandMatch("sudo rm -f file.txt")).toContain("elevated delete");
    });

    it("allows benign commands", () => {
        expect(findDangerousCommandMatch("npm test")).toBeNull();
        expect(findDangerousCommandMatch("echo hello")).toBeNull();
        expect(findDangerousCommandMatch("sed -i s/a/b/g file.txt")).toBeNull();
    });

    it("blocks via the tool without spawning", async () => {
        const res = await executeTool(bashTool, scope, { command: "rm -rf /" }, { policy: execPolicy });
        expect(res.ok).toBe(true);
        expect(JSON.parse(res.output).error).toContain("Blocked before execution");
    });
});

describe("bash tool", () => {
    it("runs a command in scope.cwd", async () => {
        const res = await executeTool(bashTool, scope, { command: "echo hello" }, { policy: execPolicy });
        expect(res.ok).toBe(true);
        const parsed = JSON.parse(res.output);
        expect(parsed.exitCode).toBe(0);
        expect(parsed.stdout.trim()).toBe("hello");
    });

    it("surfaces non-zero exit codes", async () => {
        const res = await executeTool(bashTool, scope, { command: exitCmd }, { policy: execPolicy });
        const parsed = JSON.parse(res.output);
        expect(parsed.exitCode).toBe(3);
    });

    it("honors the timeout and kills the process", async () => {
        const res = await executeTool(bashTool, scope, { command: sleepCmd, timeout: 50 }, { policy: execPolicy });
        const parsed = JSON.parse(res.output);
        expect(parsed.timedOut).toBe(true);
    }, 10_000);

    it("is denied under the default policy (exec deny)", async () => {
        const res = await executeTool(bashTool, scope, { command: "echo hi" }, { policy: new ApprovalPolicy() });
        expect(res.ok).toBe(false);
        expect(res.error).toContain("denied");
    });

    it("is not auto-excluded from PLAN (execurable-capable mode gating)", async () => {
        const registry = new CapabilityRegistry().registerAll(shellCapability());
        expect(registry.listFor("BUILD").map((t) => t.name)).toContain("bash");
        expect(registry.listFor("PLAN").map((t) => t.name)).not.toContain("bash");
    });
});

describe("shellCapability wired into the registry", () => {
    it("contributes bash at category exec with a command target", async () => {
        const registry = new CapabilityRegistry().registerAll(shellCapability());
        const tool = registry.get("bash");
        expect(tool?.category).toBe("exec");
        expect(tool?.target?.({ command: "ls" })).toBe("ls");
    });

    it("truncates runaway output", async () => {
        const res = await executeTool(
            bashTool,
            scope,
            { command: "node -e \"process.stdout.write('x'.repeat(50000))\"" },
            { policy: execPolicy },
        );
        const parsed = JSON.parse(res.output);
        expect(parsed.stdout.length).toBeLessThanOrEqual(20_000 + 200);
        expect(parsed.stdout).toContain("truncated");
    });
});