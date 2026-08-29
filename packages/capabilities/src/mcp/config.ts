// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// MCP server config discovery (capabilities/mcp).
//
// Follows the Claude Code convention: per-user `~/.ancient/.mcp.json` and
// per-project `<cwd>/.mcp.json`, each `{ "mcpServers": { "<name>": <config> } }`
// where a config is an stdio server (`command`/`args`/`env`) or an HTTP server
// (`url`). Project config overrides global on a name collision. `ANCIENT_USER_DIR`
// relocates the global root (portable + hermetic tests).

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type McpServerConfig =
    | { command: string; args?: string[]; env?: Record<string, string> }
    | { url: string };

export function mcpConfigPaths(cwd: string | null): string[] {
    const userDir = process.env.ANCIENT_USER_DIR ?? join(homedir(), ".ancient");
    const paths = [join(userDir, ".mcp.json")];
    if (cwd) paths.push(join(cwd, ".mcp.json"));
    return paths;
}

/** Merged mcpServers map, global first then project (project wins on name). */
export async function loadMcpConfig(cwd: string | null): Promise<Record<string, McpServerConfig>> {
    const merged: Record<string, McpServerConfig> = {};
    for (const path of mcpConfigPaths(cwd)) {
        try {
            const raw = JSON.parse(await readFile(path, "utf-8")) as { mcpServers?: Record<string, McpServerConfig> };
            const servers = raw?.mcpServers;
            if (servers && typeof servers === "object") {
                Object.assign(merged, servers);
            }
        } catch {
            // missing or malformed config — skip, never fatal
        }
    }
    return merged;
}