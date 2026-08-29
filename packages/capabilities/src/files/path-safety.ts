// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Path containment (capabilities/files).
//
// Ported from the shipped server helper (MIT, Microsoft) so the runtime owns the
// same floor: no file tool may touch a path that resolves outside cwd.

import { resolve, sep } from "node:path";

/**
 * Resolves `path` against `cwd` and confirms the result is actually inside
 * `cwd` — not just prefix-matching, which lets "…/project-evil" pass a naive
 * `resolved.startsWith(cwd)` check. Returns the resolved absolute path, or
 * null if it escapes cwd.
 */
export function resolveWithinCwd(cwd: string, path: string): string | null {
    const resolvedCwd = resolve(cwd);
    const resolved = resolve(resolvedCwd, path);

    const isSameDir = resolved === resolvedCwd;
    const isInsideDir = resolved.startsWith(resolvedCwd + sep);

    if (!isSameDir && !isInsideDir) {
        return null;
    }

    return resolved;
}