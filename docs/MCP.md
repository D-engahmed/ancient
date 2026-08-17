# MCP — Model Context Protocol

ANCIENT connects to MCP servers and exposes their tools to the agent as
`mcp__<server>__<tool>` — databases, browsers, issue trackers, anything the
MCP ecosystem ships.

## Configuration

Project `.mcp.json` (repo root — shareable with your team) merged over
`~/.ancient/.mcp.json` (personal):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    },
    "remote-api": { "url": "https://example.com/mcp" }
  }
}
```

- `command` + `args` (+ optional `env`) → **stdio** server, spawned on demand
- `url` → **Streamable HTTP** server

Disable MCP entirely per workspace: `"mcp": { "enabled": false }` in settings.

## Behavior

- **Lazy + cached.** Servers connect on first use and stay warm for 5 minutes
  per workspace; a restarted/edited server is picked up after the TTL or via
  `POST /extensions/mcp/reload`.
- **Failure-isolated.** A server that won't start is skipped with a log
  warning and listed as `offline` — the session continues without it.
- **Capped.** Tool results truncate at 10,000 chars so a chatty server can't
  flood the context.
- **Hookable.** `PreToolUse`/`PostToolUse` matchers accept `mcp__*` and
  `mcp__github__*` — you can gate MCP tools exactly like built-ins.
- **Visible.** The system prompt lists connected servers; `/mcp` in the CLI
  shows name, status, and tool count.

## Safety notes

- Stdio servers run with your user's permissions — treat `.mcp.json` like code
  you execute. The file is project-local, so review it when cloning repos,
  same as `package.json` scripts.
- API keys for MCP servers belong in the `env` block or your shell
  environment, never in committed files.

## Example: GitHub server

```bash
# one-time
export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...
```

`.mcp.json` with the `github` block above → the agent gains
`mcp__github__create_issue`, `mcp__github__search_code`, etc. Pair with a
project command like `/fix-issue` for a full issue-to-PR loop.
