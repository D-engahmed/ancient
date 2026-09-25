# ANCIENT Release Guide

## Release artifact contract

A versioned release produces:

- immutable container image: `ghcr.io/d-engahmed/ancient:<tag>`
- Linux x64 CLI archive
- macOS arm64 CLI archive
- Windows x64 CLI archive
- VS Code `.vsix` extension
- `SHA256SUMS` covering the downloadable artifacts

The release workflow verifies Prisma generation and migrations, the full test suite,
typecheck, server/CLI/VS Code builds, and a high-severity dependency audit before
publishing artifacts.

## Local packaging

```bash
bun install --frozen-lockfile
bun run db:generate
bun run db:migrate
bun run build:server
bun run build:cli
bun run build:vscode

bun run --cwd packages/cli build:standalone
npm pack --dry-run ./packages/cli
bun run --cwd packages/vscode package
```

The standalone CLI reads `.env` from the current working directory. Set
`ANCIENT_ENV_FILE` when configuration lives elsewhere. The runtime API endpoint
is configured with `ANCIENT_API_URL` (or legacy `API_URL`).

## Database

Development:

```bash
bun run --cwd packages/database migrate:dev
```

Deployment:

```bash
bun run db:migrate
```

Never use `prisma migrate reset` against a production database.

## Production deployment

1. Configure the `PRODUCTION_KNOWN_HOSTS` production secret.
2. Publish a version tag such as `v3.1.0`.
3. Verify the release workflow completed successfully.
4. Trigger **Production Deploy** with the exact immutable image tag.
5. Verify `/health/ready` after rollout.

Transparent resume of an execution across an API process restart is not part
of the current release contract. Durable lifecycle state is persisted, but an
in-flight run must be treated as interrupted until worker leases and restart
recovery are implemented.
