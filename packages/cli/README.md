# ANCIENT CLI

The ANCIENT CLI is the terminal client for the server-authoritative execution
gateway. Model routing, tool execution, policy checks, approvals, execution
state, and streaming remain owned by the server.

## Development

From the repository root:

```bash
bun install
bun run --cwd packages/cli dev
```

## Build

```bash
bun run build:cli
bun run --cwd packages/cli build:standalone
```

The first command builds the JavaScript distribution; the second creates a
native standalone executable for the current host.

## Configuration

- `ANCIENT_API_URL` is preferred for the execution API base URL.
- `API_URL` is retained as a compatibility alias.
- `ANCIENT_ENV_FILE` points to an explicit dotenv file.
- Otherwise the CLI loads `.env` from the current working directory.

Authentication is stored locally under `~/.ANCIENT/auth.json` with
owner-only permissions on platforms that support POSIX file modes.

## Distribution

Tagged releases publish native CLI archives for Linux x64, macOS arm64, and
Windows x64, together with checksums. See the repository-level release guide
for the full release contract.
