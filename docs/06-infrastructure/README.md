# Layer 6 --- Infrastructure

## Purpose

Infrastructure provides replaceable services beneath the engine. Every
service listed here must answer one extra question beyond what it
does: **what does the rest of the system see when this fails?**

``` mermaid
flowchart TB
    Engine --> Providers
    Engine --> Memory
    Engine --> Storage
    Engine --> Events
    Engine --> Security

    Storage --> Postgres
    Storage --> ObjectStore
    Storage --> Cache
    Storage --> Search
    Events --> EventLog
```

## 6.1 Providers

Responsibilities:

-   BYOK
-   provider abstraction
-   model metadata
-   retries
-   fallback
-   streaming
-   token usage

Provider code must not leak into strategies. Full failure design
(circuit breakers, fallback chains, BYOK failure handling) lives in
[Layer 19](../19-model-provider-harness/README.md).

## 6.2 Memory

Separate memory types:

``` mermaid
flowchart LR
    Working --> ShortTerm
    ShortTerm --> LongTerm
    LongTerm --> Retrieval
```

Do not use one database table called `memory` for everything.

### Working memory

Execution-local and temporary. **On failure:** lost by design; the
execution either has a recent checkpoint to resume from or restarts the
step. Never a source of data-loss risk because nothing durable lives
here.

### Session memory

Conversation continuity. **On failure:** degrade to "no recalled
session context" rather than blocking the request --- a stateless
response is better than a failed one.

### Long-term memory

Durable user/workspace knowledge. **On failure:** the execution
proceeds without long-term memory and marks itself
`execution.degraded`; it must never fail the whole request just because
a retrieval index is temporarily unavailable (Layer 12.10).

### Retrieval memory

Indexed information selected for context. Same degrade rule as above.

## 6.3 Storage

Suggested ownership:

  Store                 Responsibility               On-failure behavior
  --------------------- ---------------------------- --------------------------------------------
  PostgreSQL            durable relational state      hard fail the write; execution pauses, not fails, and retries against a replica/backoff
  Object storage         large artifacts               retry with backoff; if exhausted, artifact write fails but execution metadata still persists
  Cache                  ephemeral acceleration        never a hard failure --- always fall through to source of truth
  Vector/search index    retrieval                     degrade to no-retrieval, per 6.2
  Event log              execution history             this is the one store that must never silently drop writes --- see 6.4

**Rule:** only the Execution Store (Postgres) and the Event Log are
allowed to turn a write failure into an execution-level failure. Every
other store must degrade gracefully or retry silently.

## 6.4 Events

Events should be append-oriented.

Use events for:

-   observability
-   streaming
-   recovery
-   audit
-   debugging

**Failure requirement:** event log writes are on the critical path for
recovery, so they get their own durability guarantee, separate from
general storage: at-least-once append, with a monotonic per-execution
sequence number so duplicate delivery is detectable and safely ignored
downstream (Layer 12.5 idempotency). Losing an event silently is
equivalent to losing the ability to explain a failure after the fact ---
treat it with the same seriousness as losing execution state itself.

## 6.5 Security

Infrastructure security owns:

-   secrets
-   key management
-   encryption
-   credential access
-   tenant boundaries

**Failure requirement:** a secrets-service outage must fail the
*specific* operation needing that secret (e.g. cannot call a provider
requiring a stored key) --- it must never fail open into "proceed
without the credential" or "use a cached/stale credential past its
TTL."

## Data ownership rule

Every durable entity must have one clear owner, and every owner must
declare its failure behavior in the same place its ownership is
declared --- not in a separate incident postmortem written after the
first outage.
