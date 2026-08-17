// file: packages/server/src/mcp/client.ts
// MCP (Model Context Protocol) client — connects to user-configured MCP
// servers and exposes their tools to the agent as `mcp__<server>__<tool>`.
//
// Config lives in `.mcp.json` (project root, Claude Code convention) and
// `~/.ancient/.mcp.json` (user-global):
//
//   {
//     "mcpServers": {
//       "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
//       "remote-api": { "url": "https://example.com/mcp" }
//     }
//   }
//
// Connections are lazy and cached per workspace; a server that fails to
// start is skipped with a warning, never fatal to the session.

import { readFile } from "fs/promises";
import { jsonSchema, tool } from "ai";
import { createLogger } from "@ANCIENT/shared";
import { mcpConfigPaths } from "../lib/workspace";

const log = createLogger("mcp");

export type McpServerConfig =
    | { command: string; args?: string[]; env?: Record<string, string> }
    | { url: string };

export type McpServerStatus = {
    name: string;
    connected: boolean;
    toolCount: number;
    error?: string;
};

type ConnectedServer = {
    client: { listTools: () => Promise<{ tools: McpToolDescription[] }>; callTool: (req: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>; close: () => Promise<void> };
    tools: McpToolDescription[];
};

type McpToolDescription = {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; servers: Map<string, ConnectedServer>; statuses: McpServerStatus[] }>();

async function loadMcpConfig(cwd: string | null): Promise<Record<string, McpServerConfig>> {
    const merged: Record<string, McpServerConfig> = {};
    for (const path of mcpConfigPaths(cwd)) {
        try {
            const raw = JSON.parse(await readFile(path, "utf-8"));
            const servers = raw?.mcpServers;
            if (servers && typeof servers === "object") {
                Object.assign(merged, servers);
            }
        } catch (err) {
            log.warn("ignoring invalid MCP config", { path, error: err instanceof Error ? err.message : String(err) });
        }
    }
    return merged;
}

async function connectServer(name: string, config: McpServerConfig): Promise<ConnectedServer> {
    // Imported dynamically so a missing/broken SDK install can't take down
    // the whole server at boot.
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const client = new Client({ name: "ancient", version: "2.0.0" });

    if ("url" in config) {
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        await client.connect(new StreamableHTTPClientTransport(new URL(config.url)));
    } else {
        const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
        await client.connect(new StdioClientTransport({
            command: config.command,
            args: config.args ?? [],
            env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
            stderr: "ignore",
        }));
    }

    const listed = await client.listTools();
    return { client: client as ConnectedServer["client"], tools: listed.tools as McpToolDescription[] };
}

async function getServers(cwd: string): Promise<{ servers: Map<string, ConnectedServer>; statuses: McpServerStatus[] }> {
    const cached = cache.get(cwd);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached;
    }

    const configs = await loadMcpConfig(cwd);
    const servers = new Map<string, ConnectedServer>();
    const statuses: McpServerStatus[] = [];

    for (const [name, config] of Object.entries(configs)) {
        try {
            const conn = await connectServer(name, config);
            servers.set(name, conn);
            statuses.push({ name, connected: true, toolCount: conn.tools.length });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.warn("MCP server failed to start", { name, error: message });
            statuses.push({ name, connected: false, toolCount: 0, error: message });
        }
    }

    cache.set(cwd, { at: Date.now(), servers, statuses });
    return { servers, statuses };
}

/** Lists configured MCP servers and their connection status (for /mcp). */
export async function listMcpServers(cwd: string | null): Promise<McpServerStatus[]> {
    if (!cwd) return [];
    const { statuses } = await getServers(cwd);
    return statuses;
}

/**
 * Returns every tool from every connected MCP server, wrapped as AI SDK
 * tools named `mcp__<server>__<tool>`. Results are truncated so a chatty
 * MCP server can't blow up the context window.
 */
export async function getMcpTools(cwd: string): Promise<Record<string, unknown>> {
    const { servers } = await getServers(cwd);
    const tools: Record<string, unknown> = {};

    for (const [serverName, conn] of servers) {
        for (const t of conn.tools) {
            const toolName = `mcp__${serverName}__${t.name}`;
            tools[toolName] = tool({
                description: `[MCP:${serverName}] ${t.description ?? t.name}`,
                inputSchema: jsonSchema((t.inputSchema ?? { type: "object", properties: {} }) as Parameters<typeof jsonSchema>[0]),
                execute: async (args) => {
                    try {
                        const result = await conn.client.callTool({
                            name: t.name,
                            arguments: args as Record<string, unknown>,
                        });
                        const text = JSON.stringify(result);
                        return text.length > 10_000 ? text.slice(0, 10_000) + "... (truncated)" : text;
                    } catch (err) {
                        return { error: `MCP tool failed: ${err instanceof Error ? err.message : String(err)}` };
                    }
                },
            });
        }
    }

    return tools;
}

/** Drops cached connections (e.g. after the user edits .mcp.json). */
export function resetMcpCache(): void {
    cache.clear();
}
