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

export function createTools(cwd: string, mode: Mode) {
    const readOnlyTools = {
        readFile: createReadFileTool(cwd),
        listDirectory: createListDirectoryTool(cwd),
        grep: createGrepTool(cwd),
        glob: createGlobTool(cwd),
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