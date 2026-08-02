// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// file: packages/server/src/lib/fs-safety.ts

import { resolve, sep } from "path";

/**
 * Resolves `path` against `cwd` and confirms the result is actually inside
 * `cwd` — not just prefix-matching, which lets "/home/user/project-evil"
 * pass a naive `resolved.startsWith(cwd)` check because the string
 * "project-evil" starts with "project".
 *
 * Returns the resolved absolute path, or null if it escapes cwd.
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
