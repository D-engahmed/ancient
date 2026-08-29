// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// file: packages/capabilities/src/skills/frontmatter.ts
// Ported from packages/server/src/lib/frontmatter.ts for capabilities.

export type Frontmatter = Record<string, string>;

export type ParsedMarkdown<T extends Frontmatter = Frontmatter> = {
    data: T;
    body: string;
};

/**
 * Parses a markdown file with an optional `---` frontmatter block.
 * Files without frontmatter parse as `{ data: {}, body: <full text> }`.
 */
export function parseFrontmatter(raw: string): ParsedMarkdown {
    const trimmed = raw.replace(/^\uFEFF/, ""); // strip BOM
    if (!trimmed.startsWith("---")) {
        return { data: {}, body: trimmed.trim() };
    }

    const end = trimmed.indexOf("\n---", 3);
    if (end === -1) {
        return { data: {}, body: trimmed.trim() };
    }

    const header = trimmed.slice(3, end).trim();
    const body = trimmed.slice(end + 4).trim();

    const data: Frontmatter = {};
    for (const line of header.split("\n")) {
        const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        const key = m[1]!;
        let value = m[2] ?? "";
        // strip surrounding quotes
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        data[key] = value;
    }

    return { data, body };
}

/** Splits a frontmatter list value: `"a, b, c"` -> ["a","b","c"]. */
export function parseList(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
}