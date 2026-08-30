// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// fs-safety boundary tests. Exercises the exact prefix-match flaw the tools
// used to have: a sibling directory whose name STARTS with the cwd basename
// (e.g. /project vs /project-evil) must be rejected.

import { describe, expect, test } from "bun:test";
import { resolve, sep } from "path";
import { resolveWithinCwd } from "./fs-safety";

describe("resolveWithinCwd", () => {
  const tmp = resolve(process.cwd(), ".tmp-fs-safety-test");
  const cwd = resolve(tmp, "project");

  test("resolves paths that stay inside cwd", () => {
    expect(resolveWithinCwd(cwd, ".")).toBe(cwd);
    expect(resolveWithinCwd(cwd, "src/file.ts")).toBe(resolve(cwd, "src/file.ts"));
    expect(resolveWithinCwd(cwd, "./deep/nested/file")).toBe(resolve(cwd, "deep/nested/file"));
  });

  test("rejects an outright escape (..)", () => {
    expect(resolveWithinCwd(cwd, "..")).toBeNull();
    expect(resolveWithinCwd(cwd, "../secret.txt")).toBeNull();
  });

  test("rejects a sibling that merely STARTS with the cwd basename", () => {
    // resolve(cwd, "../project-evil") → <tmp>/project-evil — a string that
    // starts with <tmp>/project but is OUTSIDE cwd. The old startsWith(cwd)
    // check let this through; resolveWithinCwd must not.
    const evil = resolve(tmp, "project-evil");
    expect(resolveWithinCwd(cwd, `..${sep}project-evil`)).toBeNull();
  });

  test("rejects long absolute paths outside cwd", () => {
    const outside = resolve(tmp, "elsewhere", "file.txt");
    expect(resolveWithinCwd(cwd, outside)).toBeNull();
  });
});