# ANCIENT Coding Agent for VS Code

ANCIENT's VS Code client uses the same server-authoritative execution API as the terminal application.

Commands:
- ANCIENT: Run Coding Task
- ANCIENT: Explain Selection
- ANCIENT: Fix Current Diagnostics

The extension does not create a second runtime. Tools, approvals, model routing, policy, execution state, and streaming remain server-owned.

Configure `ancient.apiBaseUrl`, `ancient.apiKey`, and optionally `ancient.model`.
