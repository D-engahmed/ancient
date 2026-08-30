# Layer 7 --- Cross-Cutting Concerns

These concerns cross every architectural layer.

``` mermaid
flowchart TB
    Experiences
    Gateway
    Engine
    Strategies
    Capabilities
    Infrastructure

    O[Observability]
    S[Security]
    R[Reliability]
    A[Audit]
    C[Cost Control]

    O --- Experiences
    O --- Gateway
    O --- Engine
    O --- Strategies
    O --- Capabilities
    O --- Infrastructure

    S --- Gateway
    S --- Engine
    S --- Capabilities
    S --- Infrastructure
```

## Observability

Every execution should have:

-   trace ID
-   execution ID
-   parent/child relationship
-   model calls
-   capability calls
-   cost
-   latency
-   failures (typed against the [Layer 20](../20-error-and-failure-model/README.md) taxonomy, not free text)

A dashboard that cannot answer "how many executions failed with
`PROVIDER_UNAVAILABLE` vs `POLICY_DENIED` this week" is not
observability, it's a log dump.

## Reliability

Design for:

-   provider failure
-   tool failure
-   process restart
-   duplicate event delivery
-   timeout
-   partial completion

Full design in [Layer 12](../12-reliability-and-resilience/README.md).

## Audit

Record important actions, especially:

-   file modifications
-   external side effects
-   approvals
-   credential use
-   execution decisions
-   every non-retryable failure and every compensation action taken

## Cost management

Cost is a runtime concern.

The system should be able to stop saying:

``` text
Use the smartest model everywhere.
```

and instead enforce:

``` text
Use the cheapest model/strategy that satisfies policy.
```

Cost tracking must also capture the cost of **failure and retry** ---
a retried model call is not free, and a strategy with a high retry rate
may look cheap per-attempt but expensive per-completed-task.

## Multi-tenancy

Tenant boundaries must exist before enterprise features, not after.
