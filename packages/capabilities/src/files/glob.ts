// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Minimal glob + tree walker (capabilities/files).
//
// Dependency-light glob used by the glob/grep tools: `*` matches any run of
// chars, `**` additionally crosses `/`. Built on fs.promises so it works under
// any runtime without mgmt deps.

import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** `*`/`**` aware matcher over a `/`-joined relative path. */
export function globToRegExp(pattern: string): RegExp {
    const source =
        "^" +
        pattern
            .split("*")
            .map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*") +
        "$";
    return new RegExp(source);
}

export function globMatches(pattern: string, relativePath: string): boolean {
    return globToRegExp(pattern).test(relativePath);
}

/** Recursively list files under `dir`, as `/`-joined relative paths. */
export async function walkFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    async function visit(current: string, rel: string): Promise<void> {
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const childRel = rel ? `${rel}/${entry.name}` : entry.name;
            const childAbs = join(current, entry.name);
            if (entry.isDirectory()) {
                await visit(childAbs, childRel);
            } else if (entry.isFile()) {
                out.push(childRel);
            }
        }
    }
    await visit(dir, "");
    return out.sort();
}