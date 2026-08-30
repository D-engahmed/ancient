# Package and Module Boundary Rules

## Proposed conceptual structure

``` text
packages/
├── contracts/        # stable types and interfaces (incl. ErrorEnvelope, ErrorCode)
├── execution/        # lifecycle and orchestration
├── context/          # context assembly
├── model-runtime/    # routing and provider policy (Layer 19 lives mostly here)
├── strategies/       # direct / loop / subagent / team / arena
├── capabilities/     # capability contract and runtime
├── reliability/       # retry, circuit breaker, backpressure, checkpoint primitives (Layer 12)
├── infrastructure/   # adapters
├── gateway/          # transport boundary
├── experiences/      # shared experience adapters
└── shared/           # only true generic utilities
```

This is conceptual, not a command to create all packages immediately.
`reliability/` is new in this revision --- previously retry/circuit
breaker logic was implicitly duplicated inside `model-runtime` and
`capabilities`. It is now a shared package both depend on, so a fix to
backoff jitter, for instance, does not need to be made in two places.

------------------------------------------------------------------------

## Import direction

``` mermaid
flowchart TB
    Experiences --> Gateway
    Gateway --> Execution
    Execution --> Contracts
    Strategies --> Contracts
    Capabilities --> Contracts
    Infrastructure --> Contracts
    Execution --> Reliability
    Strategies --> Reliability
    Capabilities --> Reliability
    ModelRuntime[Model-Runtime] --> Reliability
    Reliability --> Contracts
```

Avoid:

``` text
contracts -> infrastructure
execution -> experience UI
strategy -> route implementation
reliability -> execution        # reliability must stay a pure primitives
                                   # library; it must never import the
                                   # thing it protects
```

------------------------------------------------------------------------

## Circular dependency rule

Circular imports are architectural smoke.

When found, ask:

``` text
Is ownership unclear?
Is a contract missing?
Should one dependency be inverted?
Are two concepts actually one module?
```

Do not solve architectural cycles only with lazy imports.
