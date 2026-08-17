// file: packages/server/src/tools/base.ts
// The seven core filesystem/shell tools. Split out of index.ts so the
// subagent `task` tool can build restricted tool sets without a circular
// import back into the full registry.

import type { Mode } from "@ANCIENT/database/enums";
import { createReadFileTool } from "./read-file";
import { createListDirectoryTool } from "./list-directory";
import { createWriteFileTool } from "./write-file";
import { createEditFileTool } from "./edit-file";
import { createGrepTool } from "./grep";
import { createGlobTool } from "./glob";
import { createBashTool } from "./bash";
import { withDedupe } from "../lib/dedupe-tool";

export type BaseToolName =
    | "readFile" | "listDirectory" | "grep" | "glob"
    | "writeFile" | "editFile" | "bash";

export const READ_ONLY_BASE_TOOLS: BaseToolName[] = ["readFile", "listDirectory", "grep", "glob"];
export const WRITE_BASE_TOOLS: BaseToolName[] = ["writeFile", "editFile", "bash"];

/**
 * Core tools for a workspace + mode. `allowedTools` (from a subagent
 * definition) further restricts the set; unknown names are ignored.
 *
 * Fresh per call = fresh per turn. Do NOT hoist the dedupe cache above this
 * function — that would turn it into a session-lifetime cache and start
 * serving stale reads.
 */
export function createBaseTools(cwd: string, mode: Mode, allowedTools?: string[]) {
    const seenThisTurn = new Map<string, unknown>();
    const allow = allowedTools && allowedTools.length > 0 ? new Set(allowedTools) : null;
    const allowed = (name: BaseToolName) => !allow || allow.has(name);

    const tools: Record<string, unknown> = {};

    if (allowed("readFile")) tools.readFile = withDedupe("readFile", createReadFileTool(cwd), seenThisTurn);
    if (allowed("listDirectory")) tools.listDirectory = withDedupe("listDirectory", createListDirectoryTool(cwd), seenThisTurn);
    if (allowed("grep")) tools.grep = withDedupe("grep", createGrepTool(cwd), seenThisTurn);
    if (allowed("glob")) tools.glob = withDedupe("glob", createGlobTool(cwd), seenThisTurn);

    // PLAN mode never gets write tools, no matter what an allow-list says.
    if (mode !== "PLAN") {
        if (allowed("writeFile")) tools.writeFile = createWriteFileTool(cwd);
        if (allowed("editFile")) tools.editFile = createEditFileTool(cwd);
        if (allowed("bash")) tools.bash = createBashTool(cwd);
    }

    return tools;
}
