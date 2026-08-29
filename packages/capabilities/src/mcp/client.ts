// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// MCP client manager (capabilities/mcp) — connects to configured MCP servers
// (stdio or HTTP), caches connections per cwd (5 min TTL), and emits remote
// tools as ToolDefinitions named `mcp__<server>__<tool>` for the registry
// (A-CAP-001). Servers that fail to start are reported, never fatal.
//
// Uses @modelcontextprotocol/sdk (a peer-level external, not an upward import
// — A-LAYER-002). The SDK is imported dynamically so a broken install can't
// take down a caller that never uses MCP.

import type { ToolDefinition } from "../core/types";
import { loadMcpConfig, type McpServerConfig } from "./config";
import { jsonSchemaToZod } from "./json-schema";

export type McpServerStatus = {
    name: string;
    connected: boolean;
    toolCount: number;
    error?: string;
};

export type McpToolDescription = {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
};

export interface McpClientLike {
    connect(transport: unknown): Promise<void>;
    listTools(): Promise<{ tools: McpToolDescription[] }>;
    callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
    close(): Promise<void>;
}

type ConnectedServer = { client: McpClientLike; tools: McpToolDescription[] };

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_MCP_RESULT_CHARS = 10_000;
let cache = new Map<string, { at: number; servers: Map<string, ConnectedServer>; statuses: McpServerStatus[] }>();

async function connectServer(name: string, config: McpServerConfig): Promise<ConnectedServer> {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const client = new Client({ name: "ANCIENT-capabilities", version: "2.0.0" }) as unknown as McpClientLike;

    if ("url" in config) {
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        await client.connect(new StreamableHTTPClientTransport(new URL(config.url)));
    } else {
        const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
        await client.connect(
            new StdioClientTransport({
                command: config.command,
                args: config.args ?? [],
                env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
                stderr: "ignore",
            }),
        );
    }

    const listed = await client.listTools();
    return { client, tools: listed.tools as McpToolDescription[] };
}

export async function getServers(cwd: string): Promise<{ servers: Map<string, ConnectedServer>; statuses: McpServerStatus[] }> {
    const cached = cache.get(cwd);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return { servers: cached.servers, statuses: cached.statuses };
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
            statuses.push({ name, connected: false, toolCount: 0, error: message });
        }
    }

    cache.set(cwd, { at: Date.now(), servers, statuses });
    return { servers, statuses };
}

/** Connection status of every configured server, for status displays. */
export async function listMcpServers(cwd: string): Promise<McpServerStatus[]> {
    return (await getServers(cwd)).statuses;
}

/**
 * Every remote tool from every connected server as a ToolDefinition named
 * `mcp__<server>__<tool>`, all category `exec` (denied by the default
 * ApprovalPolicy). inputSchema is translated from JSON Schema.
 */
export async function getMcpToolDefinitions(cwd: string): Promise<ToolDefinition[]> {
    const { servers } = await getServers(cwd);
    const definitions: ToolDefinition[] = [];

    for (const [serverName, conn] of servers) {
        for (const t of conn.tools) {
            const toolName = `mcp__${serverName}__${t.name}`;
            definitions.push({
                name: toolName,
                description: `[MCP:${serverName}] ${t.description ?? t.name}`,
                inputSchema: jsonSchemaToZod(t.inputSchema ?? {}),
                category: "exec",
                target: () => toolName,
                execute: async (_scope, args) => {
                    try {
                        const result = await conn.client.callTool({
                            name: t.name,
                            arguments: args as Record<string, unknown>,
                        });
                        if (isRecord(result) && result.isError === true) {
                            return { error: extractMcpText(result) || `MCP tool ${toolName} failed` };
                        }
                        const text = JSON.stringify(result);
                        return text.length > MAX_MCP_RESULT_CHARS
                            ? { text: text.slice(0, MAX_MCP_RESULT_CHARS) + "... (truncated)" }
                            : result;
                    } catch (err) {
                        return { error: `MCP tool failed: ${err instanceof Error ? err.message : String(err)}` };
                    }
                },
            });
        }
    }

    return definitions;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Pulls the concatenated text out of an MCP structured-content result. */
function extractMcpText(result: Record<string, unknown>): string {
    const content = result.content;
    if (!Array.isArray(content)) return "";
    return content
        .map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : ""))
        .join("\n");
}

/** Drops cached connections (e.g. after the user edits .mcp.json). */
export function resetMcpCache(): void {
    cache.clear();
}

/** Closes every live connection and clears the cache (test teardown / shutdown). */
export async function disposeMcpConnections(): Promise<void> {
    const entries = [...cache.values()];
    await Promise.allSettled(
        entries.map(async (entry) => {
            for (const conn of entry.servers.values()) {
                await conn.client.close().catch(() => {});
            }
        }),
    );
    cache = new Map();
}