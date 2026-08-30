# Layer 2 --- Interface Gateway

## Purpose

The gateway is the boundary between clients and the execution platform.
It is also the **first failure-handling boundary** in the system: most
client-visible errors are either produced here (auth, validation, rate
limiting) or translated here (engine/provider failures re-shaped into a
client-safe envelope).

``` mermaid
flowchart TB
    Client --> Edge
    Edge --> Gateway
    Gateway --> Execution

    subgraph Edge
      TLS[TLS]
      RL[Rate Limiting]
      LB[Load Balancing]
    end

    subgraph Gateway
      Auth
      Session
      Permissions
      Quotas
      Streaming
      Routing
      ErrorMap[Error Mapper]
    end
```

## Sub-layer A --- Edge

-   TLS termination
-   request size limits
-   rate limiting
-   abuse protection
-   load balancing

**Failure behavior:** every edge rejection (rate limit, oversized body,
abuse signature) returns a typed `ErrorEnvelope` with an HTTP-mapped
`ErrorCode` from the `EDGE_*` family (Layer 20) --- never a bare 4xx/5xx
with no body, and never an HTML error page.

## Sub-layer B --- Identity

The gateway resolves:

``` text
Who is making this request?
What tenant/workspace are they acting in?
What permissions apply?
```

**Failure behavior:** identity failures are always `AUTH_*` codes and
must never leak *why* authorization failed beyond what the caller is
entitled to know (Layer 13, least-privilege applies to error detail
too --- do not tell an unauthenticated caller whether a workspace ID
exists).

## Sub-layer C --- Session boundary

A session is not the same as an execution.

``` mermaid
flowchart LR
    Session --> E1[Execution 1]
    Session --> E2[Execution 2]
    Session --> E3[Execution 3]
```

**Failure behavior:** a broken session (expired, corrupted, or from an
incompatible client version) must fail closed into "start a new
session," never into an ambiguous half-restored state. Session failure
must never cascade into execution failure --- see Layer 20's
"blast-radius containment" rule.

## Sub-layer D --- Permission boundary

Permissions should be converted into an execution policy:

``` ts
interface PermissionPolicy {
  allowedCapabilities: string[]
  deniedCapabilities: string[]
  approvalRequiredFor: string[]
  workspaceScope: string[]
}
```

**Failure behavior:** a denied capability is not a system error --- it is
an expected `POLICY_DENIED` outcome. Do not classify policy denials as
`5xx`/internal failures; they are `4xx`/`POLICY_*` and must be
distinguishable from genuine platform failures in dashboards and
alerting, or on-call will drown in noise for correctly-working policy
enforcement.

## Sub-layer E --- Streaming

The gateway streams events but does not invent them.

``` mermaid
flowchart LR
    Engine[Execution Event Stream] --> Gateway
    Gateway --> SSE
    Gateway --> WebSocket
    Gateway --> CLI
```

**Failure behavior:** a dropped client connection must not cancel the
underlying execution. The execution keeps running server-side; the
client reconnects to the same `executionId` and receives a replay of
missed events from the append-only event log (Layer 6.4), then resumes
live streaming. This is the single most important gateway reliability
property --- see "Reconnect-safe streaming" below.

## Sub-layer F --- Error Mapper

Every error that reaches the gateway from downstream (Engine, Strategy,
Capability, Provider) arrives as an internal `ErrorEnvelope` (Layer 20).
The Error Mapper's only job is:

``` text
1. Strip internal detail not safe for the current caller's trust level
2. Attach a stable, documented ErrorCode the client can branch on
3. Attach retryability + suggested client action
4. Never fabricate a different error than what actually happened
```

``` ts
interface GatewayErrorResponse {
  error: {
    code: string           // e.g. "PROVIDER_UNAVAILABLE", "POLICY_DENIED"
    message: string        // safe-for-client summary
    retryable: boolean
    retryAfterMs?: number
    traceId: string        // always present, always logged server-side
  }
}
```

The `traceId` is non-negotiable: it is how a support engineer finds the
full internal error chain in Layer 7 observability without the client
ever seeing internal stack traces, provider names, or infra details.

## Reconnect-safe streaming (failure containment)

``` mermaid
flowchart TD
    Disconnect[Client disconnects] --> Continue[Execution continues server-side]
    Continue --> Log[Events keep appending to event log]
    Reconnect[Client reconnects with executionId] --> Replay[Replay events since last-seen offset]
    Replay --> Live[Resume live stream]
```

A gateway crash or restart must not be visible to the client beyond a
brief reconnect --- the execution's state of record lives in the
Execution Store (Layer 6.3), not in gateway process memory.

## Gateway anti-pattern

Do not let routes become the AI brain --- and do not let routes become
the error-handling brain either.

``` text
BAD:
chat.ts
 ├── builds prompts
 ├── selects strategy
 ├── executes tools
 ├── manages agents
 ├── writes execution state
 └── has its own try/catch error shapes per route

GOOD:
route
  -> authenticate
  -> validate
  -> create execution request
  -> stream execution events
  -> map any ErrorEnvelope through the one shared Error Mapper
```
