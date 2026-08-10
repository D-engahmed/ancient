// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// file: packages/server/src/tools/index.ts

import type { Mode } from "@ANCIENT/database/enums";
import { createReadFileTool } from "./read-file";
import { createListDirectoryTool } from "./list-directory";
import { createWriteFileTool } from "./write-file";
import { createEditFileTool } from "./edit-file";
import { createGrepTool } from "./grep";
import { createGlobTool } from "./glob";
import { createBashTool } from "./bash";
import { withDedupe } from "../lib/dedupe-tool";

export function createTools(cwd: string, mode: Mode) {
    // Fresh per call = fresh per turn (createTools is invoked once per
    // streamAIResponse). Do NOT hoist this above the function — that would
    // turn it into a session-lifetime cache and start serving stale reads.
    const seenThisTurn = new Map<string, unknown>();

    const readOnlyTools = {
        readFile: withDedupe("readFile", createReadFileTool(cwd), seenThisTurn),
        listDirectory: withDedupe("listDirectory", createListDirectoryTool(cwd), seenThisTurn),
        grep: withDedupe("grep", createGrepTool(cwd), seenThisTurn),
        glob: withDedupe("glob", createGlobTool(cwd), seenThisTurn),
    };

    if (mode === "PLAN") {
        return readOnlyTools;
    }

    return {
        ...readOnlyTools,
        writeFile: createWriteFileTool(cwd),
        editFile: createEditFileTool(cwd),
        bash: createBashTool(cwd),
    };
};