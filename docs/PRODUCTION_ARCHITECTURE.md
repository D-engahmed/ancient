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

## Release gates

A production release must pass:

1. dependency install with the committed lockfile;
2. Prisma client generation;
3. typecheck;
4. unit/integration tests;
5. production image build;
6. database migration against staging;
7. restart/recovery tests;
8. security/SSRF tests;
9. backup/restore verification.

