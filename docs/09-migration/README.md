# Migration Plan --- Current ANCIENT to Architecture V2

## Goal

Do not rewrite everything.

Move boundaries gradually.

``` mermaid
flowchart LR
    Current[Current Repository] --> Audit
    Audit --> Contracts
    Contracts --> Extract
    Extract --> Migrate
    Migrate --> Verify
```

## Phase 0 --- Freeze expansion

Pause major new features while architecture boundaries are reviewed.

Allowed:

-   bug fixes
-   tests
-   observability
-   documentation
-   architecture extraction

## Phase 1 --- Define contracts

Before moving code, define:

-   Execution
-   ExecutionEvent
-   ExecutionState
-   Strategy
-   Capability
-   Context
-   Artifact
-   **ErrorEnvelope / ErrorCode** (Layer 20 --- define this alongside the
    others, not after; every contract above needs to declare its error
    shape at the same time it declares its success shape)

## Phase 2 --- Extract execution core

Current target:

``` text
server routes -> ExecutionEngine
ExecutionEngine -> strategy
strategy -> capabilities
```

Goal:

``` text
server routes -> Execution API
Execution API -> Unified Execution Engine
Unified Engine -> Strategy / Context / Model
```

## Phase 3 --- Separate strategies

Move:

``` text
ArenaCoordinator
Team protocols
Subagent logic
```

behind a common strategy interface, **including** the common
`StrategyFailurePolicy` shape from Layer 4/20 --- do not migrate the
happy path first and bolt error handling on later; migrate both at
once per strategy.

## Phase 4 --- Normalize capability runtime

Bring tools, skills, MCP, commands and future computer/design
capabilities under one capability contract, including the mandatory
`idempotent` / `reversible` / `errorClass` declarations from Layer 5.
A capability that cannot declare these should be treated as
`idempotent: false, reversible: false` by default (fail safe) until
someone verifies otherwise --- never assume safety by omission.

## Phase 4.5 --- Provider plugin extraction

``` text
Wrap each existing vendor SDK call behind ModelProviderPlugin
Move every "if provider === x" branch into a per-provider plugin file
Introduce Provider Registry + Model Policy before adding the next provider
Only after that: allow user-supplied BYOK keys as first-class plugins
```

See [Layer 19](../19-model-provider-harness/README.md) for the full
spec.

## Phase 5 --- Durable execution state

Introduce:

``` mermaid
flowchart LR
    RuntimeState --> Checkpoint
    Checkpoint --> DurableStore
    DurableStore --> Recovery
```

## Phase 5.5 --- Error taxonomy and retry/compensation rollout

``` text
Replace ad-hoc try/catch blocks with the shared ErrorEnvelope
Classify every existing error site against the Layer 20 ErrorCode table
Add circuit breakers per provider and per capability kind
Add compensation handlers for every non-idempotent capability
Add execution.retrying / execution.degraded / execution.fallback_engaged events
```

This phase is deliberately *after* Phase 5 (durable state) because
retry and compensation are meaningless without a durable place to
record what was already attempted.

## Phase 6 --- Add observability before complexity

Before adding more agents:

-   execution traces
-   strategy traces
-   tool traces
-   provider usage
-   cost metrics
-   **failure-classification metrics** (counts and rates per
    `ErrorCode`, per strategy, per provider --- see Layer 20 and Layer 7)

## Phase 7 --- Expand experiences

Only after the shared engine is stable:

1.  Coding
2.  IDE
3.  Design
4.  Cowork
5.  General API ecosystem

## Stop conditions

Stop and review if:

-   package boundaries become circular
-   one subsystem imports product-specific UI code
-   execution logic appears in routes
-   multi-agent is required for simple tasks
-   persistence is bypassed by production flows
-   capabilities bypass permission policy
-   **a new error shape appears outside the shared `ErrorEnvelope`**
-   **a capability is retried without an idempotency check**
-   **a provider outage produces a visible session restart instead of a
    silent fallback**
