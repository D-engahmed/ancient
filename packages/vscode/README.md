# ANCIENT Coding Agent for VS Code

ANCIENT's VS Code client uses the same server-authoritative execution API as the terminal application.

## Commands

- **ANCIENT: Run Coding Task**
- **ANCIENT: Explain Selection**
- **ANCIENT: Fix Current Diagnostics**

The extension does not create a second runtime. Tools, approvals, model routing, policy, execution state, and streaming remain server-owned.

## Configuration

Set these in **machine-scoped** VS Code settings:

- `ancient.apiBaseUrl` — local loopback HTTP is supported for development. Remote servers must use HTTPS.
- `ancient.apiKey` — platform API key; it is intentionally machine-scoped so a workspace cannot replace the destination or credential.
- `ancient.model` — optional model id; empty uses the server default.
- `ancient.remoteWorkspaceRoot` — required for remote servers. This is the server-side filesystem path that corresponds to the opened local workspace.

For a remote deployment, ANCIENT never invents a filesystem mapping. The active workspace is mapped under `ancient.remoteWorkspaceRoot`, and active files outside that workspace are rejected.

The extension also reconnects interrupted execution SSE streams from the last received event id instead of treating a dropped connection as successful completion.
