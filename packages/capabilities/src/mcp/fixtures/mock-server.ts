// Mock MCP server used by mcp.test.ts e2e — spawned as a true stdio child
// process (command = process.execPath under bun). Exposes one tool.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mock-server", version: "1.0.0" }, { capabilities: { tools: {} } });

server.registerTool(
    "greet",
    {
        title: "greet",
        description: "Greet a person by name",
        inputSchema: {
            name: z.string().describe("The name to greet"),
            count: z.number().int().optional().describe("Times to repeat"),
        },
    },
    async ({ name, count }) => {
        const n = Math.max(1, Math.min(count ?? 1, 10));
        return {
            content: [{ type: "text", text: Array(n).fill(`hi ${name}`).join("\n") }],
        };
    },
);

await server.connect(new StdioServerTransport());