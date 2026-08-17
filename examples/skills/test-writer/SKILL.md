---
name: test-writer
description: Write or extend automated tests for a module or feature. Use when the user asks for tests, coverage, or TDD.
allowed-tools: readFile, listDirectory, glob, grep, writeFile, editFile, bash
---

# Test Writer

1. **Discover conventions first.** Glob for existing test files (`**/*.test.*`, `**/*.spec.*`, `tests/`), read 1–2 of them, and identify the framework (vitest/jest/pytest/go test…). Match their style exactly — imports, naming, fixtures, file placement.
2. **Cover behavior, not lines.** Prioritize: happy path, boundary values, error paths, and regressions for recently fixed bugs.
3. **Keep tests deterministic.** No wall-clock dependence, no network, no test-order coupling.
4. **Run what you write.** Execute the test command via bash and iterate until green. Report the exact command used.

Output: list of test files created/modified, what each covers, and the test run result.
