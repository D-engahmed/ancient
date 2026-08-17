---
name: commit
description: Stage current changes and craft a conventional-commit message. Use when the user says commit, or after a completed task.
allowed-tools: bash, readFile, grep
---

# Commit

1. Run `git status` and `git diff --stat` (plus `git diff` for small changes) to understand everything that changed.
2. Group related changes; if unrelated work is mixed in, warn the user and stage only what belongs to the current task.
3. Write a conventional-commit message: `type(scope): summary` where type ∈ feat, fix, refactor, perf, test, docs, chore. Summary ≤ 72 chars, imperative mood, no trailing period.
4. Add a body only when the *why* is non-obvious.
5. Run `git add` + `git commit` — never `git push` unless explicitly asked, and never `--amend` on shared history.
