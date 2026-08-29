// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// MCP tools (capabilities/mcp): `listMcpServers` (read category) plus a
// dynamic factory that folds every remote tool into the registry as
// `mcp__<server>__<tool>` (category `exec`, denied by default — A-CAP-001).

import { toolInputSchemas } from "@ANCIENT/shared";
import type { ToolDefinition } from "../core/types";
import { getMcpToolDefinitions, listMcpServers } from "./client";

export const listMcpServersTool: ToolDefinition = {
    name: "listMcpServers",
    description:
        "List configured MCP servers and their connection status. Use to discover available mcp__* tools before calling them.",
    inputSchema: toolInputSchemas.listMcpServers,
    category: "read",
    execute: async (scope) => {
        const servers = await listMcpServers(scope.cwd);
        return { servers };
    },
};

/**
 * Dynamic part of the MCP capability: connects to configured servers and
 * returns one ToolDefinition per remote tool. Unlike the static modules,
 * MCP tools only exist after a connection succeeds, so callers (registry
 * builders in the engine) pull them at startup, then register.
 */
export function mcpToolDefinitions(cwd: string): Promise<ToolDefinition[]> {
    return getMcpToolDefinitions(cwd);
}

export * from "./config";
export * from "./client";