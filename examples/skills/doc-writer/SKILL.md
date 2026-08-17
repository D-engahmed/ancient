---
name: doc-writer
description: Write or update READMEs, API docs, and architecture docs from the actual code. Use when the user asks for documentation.
allowed-tools: readFile, listDirectory, glob, grep, writeFile, editFile, bash
---

# Doc Writer

1. **Document what IS, not what should be.** Read the real code/config before writing anything. Every command, env var, and endpoint you mention must exist.
2. **Match the audience.** README = get running in 5 minutes. API docs = exact contracts with examples. Architecture docs = components, data flow, and the *why* behind decisions.
3. **Structure:** overview → quickstart → reference → troubleshooting. Put the 80% use case first.
4. **Verify examples.** If you write a shell command or code sample, run or typecheck it via bash when possible.
5. **Keep it maintainable.** Prefer tables for config/options; avoid duplicating info that lives in code comments.
