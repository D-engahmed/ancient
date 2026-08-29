// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Files capability tests (capabilities/files). 14 tests over real temp dirs.

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CapabilityRegistry, executeTool } from "../core";
import { ApprovalPolicy } from "@ANCIENT/infrastructure/security";
import type { ExecutionScope } from "../core/types";
import {
    editFileTool,
    fileCapability,
    globTool,
    grepTool,
    listDirectoryTool,
    readFileTool,
    writeFileTool,
} from "./tools";
import { resolveWithinCwd } from "./path-safety";

let dir: string;
let scope: ExecutionScope;
const policy = new ApprovalPolicy();
const writePolicy = new ApprovalPolicy().allow("write");

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "caps-files-"));
    scope = { cwd: dir };
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), "hello world\nconst x = 1;\n");
    await writeFile(join(dir, "README.md"), "# readme\ngreetings\n");
});

afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe("path-safety", () => {
    it("resolves inside cwd", () => {
        const r = resolveWithinCwd(dir, "src/a.ts");
        expect(r).toBe(join(dir, "src", "a.ts"));
    });

    it("rejects paths escaping cwd (incl. prefix masquerade)", () => {
        expect(resolveWithinCwd(dir, "../outside")).toBeNull();
        expect(resolveWithinCwd(dir, `${dir}-evil`)).toBeNull();
    });
});

describe("read tools", () => {
    it("readFile returns file contents", async () => {
        const res = await executeTool(readFileTool, scope, { path: "src/a.ts" }, { policy });
        expect(res.ok).toBe(true);
        const parsed = JSON.parse(res.output);
        expect(parsed.content).toContain("hello world");
    });

    it("readFile blocks an escaping path", async () => {
        const res = await executeTool(readFileTool, scope, { path: "../../etc/passwd" }, { policy });
        expect(JSON.parse(res.output).error).toContain("escapes cwd");
    });

    it("listDirectory lists entries with types", async () => {
        const res = await executeTool(listDirectoryTool, scope, { path: "." }, { policy });
        const parsed = JSON.parse(res.output);
        expect(parsed.entries.map((e: { name: string }) => e.name)).toEqual(["README.md", "src"]);
        expect(parsed.entries.find((e: { name: string }) => e.name === "src").type).toBe("directory");
    });

    it("glob finds nested matches", async () => {
        const res = await executeTool(globTool, scope, { pattern: "src/*.ts", path: "." }, { policy });
        expect(JSON.parse(res.output).matches).toEqual(["src/a.ts"]);
    });

    it("grep finds matching lines with positions", async () => {
        const res = await executeTool(grepTool, scope, { pattern: "const x", path: "." }, { policy });
        const parsed = JSON.parse(res.output);
        expect(parsed.matches[0]).toMatchObject({ file: "src/a.ts", line: 2 });
    });

    it("grep honors the include filename filter", async () => {
        const res = await executeTool(
            grepTool,
            scope,
            { pattern: "greetings", path: ".", include: "*.md" },
            { policy },
        );
        const parsed = JSON.parse(res.output);
        expect(parsed.matches.map((m: { file: string }) => m.file)).toEqual(["README.md"]);
    });
});

describe("write tools", () => {
    it("writeFile creates a file", async () => {
        const res = await executeTool(writeFileTool, scope, { path: "new.txt", content: "data" }, { policy: writePolicy });
        expect(JSON.parse(res.output).ok).toBe(true);
        expect(await readFile(join(dir, "new.txt"), "utf8")).toBe("data");
    });

    it("writeFile creates parent directories", async () => {
        await executeTool(writeFileTool, scope, { path: "docs/nested/x.md", content: "hi" }, { policy: writePolicy });
        expect(await readFile(join(dir, "docs", "nested", "x.md"), "utf8")).toBe("hi");
    });

    it("editFile replaces a unique oldString", async () => {
        await executeTool(writeFileTool, scope, { path: "edit.txt", content: "alpha beta alpha" }, { policy: writePolicy });
        const res = await executeTool(editFileTool, scope, { path: "edit.txt", oldString: " beta ", newString: " gamma " }, { policy: writePolicy });
        expect(JSON.parse(res.output).ok).toBe(true);
        expect(await readFile(join(dir, "edit.txt"), "utf8")).toBe("alpha gamma alpha");
    });

    it("editFile errors on a non-unique oldString", async () => {
        await executeTool(writeFileTool, scope, { path: "dup.txt", content: "same same" }, { policy: writePolicy });
        const res = await executeTool(editFileTool, scope, { path: "dup.txt", oldString: "same", newString: "x" }, { policy: writePolicy });
        expect(JSON.parse(res.output).error).toContain("times");
    });
});

describe("fileCapability wired into the registry", () => {
    it("contributes all six tools with correct categories", () => {
        const registry = new CapabilityRegistry().registerAll(fileCapability());
        expect(registry.listNames()).toEqual([
            "readFile",
            "listDirectory",
            "glob",
            "grep",
            "writeFile",
            "editFile",
        ]);
        expect(registry.get("readFile")?.category).toBe("read");
        expect(registry.get("writeFile")?.category).toBe("write");
    });

    it("excludes write tools from PLAN mode", () => {
        const registry = new CapabilityRegistry().registerAll(fileCapability());
        expect(registry.listFor("PLAN").map((t) => t.name)).toEqual([
            "readFile",
            "listDirectory",
            "glob",
            "grep",
        ]);
    });
});