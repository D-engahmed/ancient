// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// JSON Schema → zod translator (capabilities/mcp) so MCP tool inputSchema
// (JSON Schema) can become ToolDefinition zod inputSchema (A-CAP-001). Covers
// the common shapes real servers emit; anything unrecognized degrades to
// z.unknown() and the remote server does the rejecting.

import { z } from "zod";

const UNKNOWN = z.unknown();
type Record_ = Record<string, unknown>;
const isRecord = (v: unknown): v is Record_ => v !== null && typeof v === "object" && !Array.isArray(v);

export function jsonSchemaToZod(schema: unknown): z.ZodType {
    if (!isRecord(schema)) return UNKNOWN;

    if (Array.isArray(schema.enum)) {
        const values = schema.enum.filter((v): v is string => typeof v === "string");
        if (values.length > 0 && values.length === (schema.enum as unknown[]).length) {
            return z.enum(values as [string, ...string[]]);
        }
        return UNKNOWN;
    }

    const t = schema.type;
    if (t === "string") return z.string();
    if (t === "number") return z.number();
    if (t === "integer") return z.number().int();
    if (t === "boolean") return z.boolean();
    if (t === "array") return z.array(jsonSchemaToZod(schema.items));
    if (t === "object") {
        const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
        const properties = isRecord(schema.properties) ? schema.properties : {};
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, value] of Object.entries(properties)) {
            const base = jsonSchemaToZod(value);
            shape[key] = required.includes(key) ? base : base.optional();
        }
        return z.object(shape).passthrough();
    }
    return UNKNOWN;
}