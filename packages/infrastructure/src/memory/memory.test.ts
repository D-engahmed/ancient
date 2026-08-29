// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMemory, buildMemoryPromptBlock } from "./loader";

let dir: string;
let projectDir: string;

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ancient-memory-"));
    projectDir = join(dir, "nested", "project");
    mkdirSync(projectDir, { recursive: true });
    // user-global memory
    mkdirSync(join(dir, ".ancient"), { recursive: true });
    writeFileSync(join(dir, ".ancient", "ANCIENT.md"), "Always use tabs.\n");
    // ancestor memory (the "nested" dir)
    writeFileSync(join(dir, "nested", "ANCIENT.md"), "Root conventions.\n");
    // project memory
    writeFileSync(join(projectDir, "ANCIENT.md"), "Project-specific rules.\n");
});

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe("loadMemory", () => {
    it("loads user, ancestor, and project memory in precedence order", async () => {
        const files = await loadMemory({ cwd: projectDir, homedir: dir });
        const scopes = files.map((f) => f.scope);
        expect(scopes).toEqual(["user", "ancestor", "project"]);
    });

    it("returns empty when no homedir and no cwd", async () => {
        const files = await loadMemory({ cwd: null, homedir: join(dir, "does-not-exist") });
        expect(files).toEqual([]);
    });

    it("truncates a file over the per-file budget", async () => {
        const tinyDir = mkdtempSync(join(tmpdir(), "ancient-mem-trunc-"));
        writeFileSync(join(tinyDir, "ANCIENT.md"), "x".repeat(100));
        const files = await loadMemory({
            cwd: tinyDir,
            homedir: join(tinyDir, "no-home"),
            budget: { maxFileChars: 10 },
        });
        expect(existsSync(join(tinyDir, "ANCIENT.md"))).toBe(true);
        // content truncated to 10 chars + a truncation marker, far under the 100 original
        expect(files[0]!.content.startsWith("x".repeat(10))).toBe(true);
        expect(files[0]!.content).toContain("truncated");
        expect(files[0]!.content.length).toBeLessThan(50);
        rmSync(tinyDir, { recursive: true, force: true });
    });

    it("drops least-specific files when over the total budget", async () => {
        // project memory alone exceeds the total budget -> user/ancestor dropped
        const hugeProject = mkdtempSync(join(tmpdir(), "ancient-mem-total-"));
        mkdirSync(join(hugeProject, ".ancient"), { recursive: true });
        writeFileSync(join(hugeProject, ".ancient", "ANCIENT.md"), "user");
        writeFileSync(join(hugeProject, "ANCIENT.md"), "y".repeat(1000));
        const files = await loadMemory({
            cwd: hugeProject,
            homedir: hugeProject,
            budget: { maxTotalChars: 50, maxFileChars: 1000 },
        });
        const scopes = files.map((f) => f.scope);
        expect(scopes).toContain("project");
        expect(scopes).not.toContain("user");
        rmSync(hugeProject, { recursive: true, force: true });
    });
});

describe("buildMemoryPromptBlock", () => {
    it("returns empty string when there are no files", () => {
        expect(buildMemoryPromptBlock([])).toBe("");
    });
    it("labels project memory and embeds content", () => {
        const block = buildMemoryPromptBlock([{ path: "/x/ANCIENT.md", scope: "project", content: "rules" }]);
        expect(block).toContain("Project memory");
        expect(block).toContain("rules");
        expect(block).toContain("## Memory");
    });
});
