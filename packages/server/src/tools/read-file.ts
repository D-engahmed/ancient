// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// file: packages/server/src/tools/read-file.ts

import { readFile } from "fs/promises";
import { tool } from "ai";
import { z } from "zod";
import { resolveWithinCwd } from "../lib/fs-safety";

const MAX_FILE_SIZE = 10_000;

export function createReadFileTool(cwd: string) {
    return tool({
        description:
            "Read the contents of a file in the project. Returns the file text, truncated if very large.",
        inputSchema: z.object({
            path: z.string().describe("Relative path to the file to read"),
        }),
        execute: async ({ path }) => {
            const resolved = resolveWithinCwd(cwd, path);

            if (!resolved) {
                return { error: "Path is outside the project directory" };
            }

            try {
                const content = await readFile(resolved, "utf-8");
                if (content.length > MAX_FILE_SIZE) {
                    return {
                        content: content.slice(0, MAX_FILE_SIZE),
                        truncated: true,
                        totalLength: content.length,
                    };
                }
                return { content };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to read file: ${message}` };
            }
        },
    })
};