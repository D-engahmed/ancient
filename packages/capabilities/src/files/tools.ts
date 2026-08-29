// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// File capability tools (capabilities/files).
//
// Six ToolDefinitions (read: readFile/listDirectory/glob/grep; write:
// writeFile/editFile) contributing to the CapabilityRegistry (A-CAP-001). Input
// schemas come from @ANCIENT/shared toolInputSchemas so every layer agrees on
// tool shapes. Every path is containment-checked against scope.cwd before use.

import { mkdir, readdir, readFile, writeFile as writeFileFs } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { toolInputSchemas } from "@ANCIENT/shared";
import type { ToolDefinition } from "../core/types";
import { globMatches, walkFiles } from "./glob";
import { resolveWithinCwd } from "./path-safety";

const MAX_GREP_MATCHES = 100;

type PathArg = { path?: string };

function targetOf(): (args: unknown) => string | undefined {
    return (a) => {
        const path = (a as PathArg).path;
        return path === undefined ? "." : path;
    };
}

function resolveOrError(cwd: string, path: string): { ok: true; resolved: string } | { ok: false; error: string } {
    const resolved = resolveWithinCwd(cwd, path);
    if (resolved === null) {
        return { ok: false, error: `path escapes cwd: ${path}` };
    }
    return { ok: true, resolved };
}

export const readFileTool: ToolDefinition = {
    name: "readFile",
    description: "Read a file's contents",
    inputSchema: toolInputSchemas.readFile,
    category: "read",
    target: targetOf(),
    execute: async (scope, args) => {
        const input = args as { path: string };
        const hit = resolveOrError(scope.cwd, input.path);
        if (!hit.ok) return hit;
        try {
            const content = await readFile(hit.resolved, "utf8");
            return { path: input.path, content };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    },
};

export const listDirectoryTool: ToolDefinition = {
    name: "listDirectory",
    description: "List directory entries (names + types)",
    inputSchema: toolInputSchemas.listDirectory,
    category: "read",
    target: targetOf(),
    execute: async (scope, args) => {
        const input = args as { path?: string };
        const hit = resolveOrError(scope.cwd, input.path ?? ".");
        if (!hit.ok) return hit;
        try {
            const entries = await readdir(hit.resolved, { withFileTypes: true });
            return {
                path: input.path ?? ".",
                entries: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "directory" : "file" })),
            };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    },
};

export const globTool: ToolDefinition = {
    name: "glob",
    description: "Find files under a path matching a glob pattern",
    inputSchema: toolInputSchemas.glob,
    category: "read",
    target: targetOf(),
    execute: async (scope, args) => {
        const input = args as { pattern: string; path?: string };
        const hit = resolveOrError(scope.cwd, input.path ?? ".");
        if (!hit.ok) return hit;
        try {
            const all = await walkFiles(hit.resolved);
            const matches = all.filter((rel) => globMatches(input.pattern, rel));
            return { path: input.path ?? ".", pattern: input.pattern, matches };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    },
};

export const grepTool: ToolDefinition = {
    name: "grep",
    description: "Search file contents for a pattern (optionally include-filtered by filename)",
    inputSchema: toolInputSchemas.grep,
    category: "read",
    target: targetOf(),
    execute: async (scope, args) => {
        const input = args as { pattern: string; path?: string; include?: string };
        const hit = resolveOrError(scope.cwd, input.path ?? ".");
        if (!hit.ok) return hit;

        let matcher: RegExp;
        try {
            matcher = new RegExp(input.pattern);
        } catch {
            matcher = new RegExp(input.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        }

        const results: { file: string; line: number; text: string }[] = [];
        try {
            const all = await walkFiles(hit.resolved);
            for (const rel of all) {
                if (input.include && !globMatches(input.include, basename(rel))) continue;
                const text = await readFile(join(hit.resolved, ...rel.split("/")), "utf8");
                const lines = text.split("\n");
                for (let i = 0; i < lines.length && results.length < MAX_GREP_MATCHES; i++) {
                    const line = lines[i] ?? "";
                    if (matcher.test(line)) {
                        results.push({ file: rel, line: i + 1, text: line });
                    }
                }
                if (results.length >= MAX_GREP_MATCHES) break;
            }
            return { path: input.path ?? ".", pattern: input.pattern, truncated: results.length >= MAX_GREP_MATCHES, matches: results };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    },
};

export const writeFileTool: ToolDefinition = {
    name: "writeFile",
    description: "Create or overwrite a file with content",
    inputSchema: toolInputSchemas.writeFile,
    category: "write",
    target: targetOf(),
    execute: async (scope, args) => {
        const input = args as { path: string; content: string };
        const hit = resolveOrError(scope.cwd, input.path);
        if (!hit.ok) return hit;
        try {
            await mkdir(hit.resolved.split(sep).slice(0, -1).join(sep), { recursive: true });
            await writeFileFs(hit.resolved, input.content, "utf8");
            return { path: input.path, ok: true };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    },
};

export const editFileTool: ToolDefinition = {
    name: "editFile",
    description: "Replace a unique oldString with newString in a file",
    inputSchema: toolInputSchemas.editFile,
    category: "write",
    target: targetOf(),
    execute: async (scope, args) => {
        const input = args as { path: string; oldString: string; newString: string };
        const hit = resolveOrError(scope.cwd, input.path);
        if (!hit.ok) return hit;
        try {
            const content = await readFile(hit.resolved, "utf8");
            const occurrences = content.split(input.oldString).length - 1;
            if (occurrences === 0) return { error: `oldString not found in ${input.path}` };
            if (occurrences > 1) return { error: `oldString matches ${occurrences} times in ${input.path}; make it unique` };
            await writeFileFs(hit.resolved, content.replace(input.oldString, input.newString), "utf8");
            return { path: input.path, ok: true };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    },
};

/** The files capability: all six tools at once. */
export function fileCapability(): ToolDefinition[] {
    return [readFileTool, listDirectoryTool, globTool, grepTool, writeFileTool, editFileTool];
}