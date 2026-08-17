---
name: code-review
description: Rigorous code review of changes or specific files — bugs, security, performance, style. Use when the user asks to review code, before committing, or after large edits.
allowed-tools: readFile, listDirectory, glob, grep, bash
---

# Code Review

Review the target (files, diff, or feature) with this checklist, in order:

1. **Correctness** — logic errors, off-by-ones, null/undefined paths, error handling gaps, race conditions.
2. **Security** — injection, secrets in code, unsafe deserialization, missing auth checks, SSRF/path traversal.
3. **Contracts** — does the change break callers? Check every import site of modified exports with grep.
4. **Performance** — N+1 queries, unbounded loops, needless re-renders, missing indexes.
5. **Style** — match the file's existing conventions; do not impose outside preferences.

## How to work

- If reviewing uncommitted work, run `git diff` (staged and unstaged) via bash first.
- Read the FULL file around each changed hunk — diffs lie about context.
- Verify suspected bugs by reading the calling code, not by guessing.

## Output format

Findings ordered by severity (critical / major / minor / nit), each as:

```
[severity] file.ts:123 — one-line problem statement
Why it matters: one sentence.
Fix: concrete suggestion or patch sketch.
```

End with a verdict line: `Verdict: ship | fix-first | needs-discussion`.
