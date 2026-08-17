---
name: refactor
description: Safe, behavior-preserving refactoring of code structure. Use when the user asks to clean up, simplify, deduplicate, or restructure code.
allowed-tools: readFile, listDirectory, glob, grep, writeFile, editFile, bash
---

# Refactor

Golden rule: **no behavior changes.** A refactor that also fixes a bug is two commits.

1. **Map before moving.** Use grep to find every caller/importer of the code you're touching. List them before editing.
2. **Small steps.** One mechanical transformation at a time (extract function, rename, move file). After each step, the project should still build.
3. **Verify continuously.** Run the build/typecheck/tests after each step via bash, not once at the end.
4. **Don't modernize unprompted.** Match surrounding style; flag bigger opportunities in the final report instead of doing them.

Final report: transformations applied, verification results, and follow-up opportunities you deliberately did NOT do.
