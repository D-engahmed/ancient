---
name: fix-issue
description: Fix a GitHub/Gitea issue described by number or URL
---

Work on issue: $ARGUMENTS

Fetch the issue details if you have a tool for it (gh CLI via bash, or an MCP server), otherwise ask me to paste the description. Then:

1. Restate the problem in your own words and confirm the expected behavior.
2. Locate the relevant code with the explore subagent if the area is unfamiliar.
3. Implement the minimal fix.
4. Add or update a regression test.
5. Run the test suite and report the result.
