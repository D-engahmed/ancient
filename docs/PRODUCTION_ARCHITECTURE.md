# Production Architecture

ANCIENT production is designed around one invariant: **PostgreSQL is the
authoritative record of execution state; process memory is only a live cache.**

## Deployment topology

```
Client / CLI / Web
       |
       v
   Reverse proxy
       |
       v
   ANCIENT API
       |
       +------ PostgreSQL (private network)
       |
       +------ Queue / worker plane (next hardening phase)
                       |
                       v
                isolated execution
```

The API must not expose PostgreSQL or Adminer to the public network.

## Security defaults

- User-supplied provider endpoints cannot target private, loopback, link-local,
  metadata, or internal DNS destinations by default.
- `ANCIENT_ALLOW_LOCAL_PROVIDER_ENDPOINTS=true` is an explicit operator-only
  exception for trusted self-hosted deployments.
- Provider URLs must not contain embedded credentials.
- Production containers run as a non-root user, drop Linux capabilities, use a
  read-only root filesystem, and cap process/memory/CPU resources.

## Durable execution

Execution events use PostgreSQL and allocate sequence numbers under a
transaction-scoped advisory lock. This removes the count-then-insert race that
could assign the same sequence to concurrent writers.

The current live execution hub remains an in-process runtime cache. Full
restart recovery and worker leasing are deliberately the next release-blocking
phase; a deployment must not claim transparent execution resume until that
work is complete.


## Artifact release gates

The v3.1 packaging/release workflow is responsible for proving that the
published artifacts are buildable and reproducible:

1. dependency install with the committed lockfile;
2. Prisma client generation and migration application;
3. typecheck;
4. unit/integration tests;
5. server, CLI, and VS Code builds;
6. CLI package smoke verification;
7. production container build;
8. dependency audit, CodeQL, and secret scan.

## Production deployment gates

Deployment is a separate operational gate. Before exposing an installation
to production traffic, operators must additionally verify:

1. database migration against staging;
2. restart/recovery behavior for in-flight executions;
3. security/SSRF controls against the deployed environment;
4. backup/restore verification.

The current v3.1 release contract does not claim transparent in-flight
execution resume across an API process restart. Durable lifecycle state is
persisted, but active-run recovery requires the future worker-leasing and
restart-recovery phase documented in docs/RELEASE.md.
