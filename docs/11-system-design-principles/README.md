# System Design Principles

## 1. Single Responsibility at system scale

SRP is not only about classes.

A package should have one dominant reason to change.

``` text
GOOD:
execution package changes because execution semantics change

BAD:
execution package changes because UI, auth, providers,
database schema, and agent behavior all changed
```

------------------------------------------------------------------------

## 2. High cohesion

Things that change together should usually live together.

``` mermaid
flowchart LR
    ExecutionState --> ExecutionLifecycle
    ExecutionLifecycle --> ExecutionEvents
    ExecutionEvents --> ExecutionRecovery
```

These concepts are cohesive.

Do not group systems only because they are technically similar.

------------------------------------------------------------------------

## 3. Low coupling

Subsystem A should know as little as possible about subsystem B's
internals.

Prefer:

``` text
A -> Interface <- B
```

over:

``` text
A -> B internals
```

------------------------------------------------------------------------

## 4. Dependency direction

Higher-level policy must not depend directly on replaceable low-level
details.

``` mermaid
flowchart TB
    Policy[High-level Policy] --> Contract
    Infrastructure --> Contract
    Contract --> Implementation[Selected Implementation]
```

Example:

``` text
Execution Engine
    depends on
Provider Contract

NOT

Execution Engine
    depends on
Anthropic SDK directly
```

------------------------------------------------------------------------

## 5. Dependency inversion

The core defines what it needs.

Infrastructure implements that need.

``` text
Core:
  IExecutionStore

Infrastructure:
  PostgresExecutionStore
```

This protects the core from infrastructure churn.

------------------------------------------------------------------------

## 6. Open for extension, closed against uncontrolled modification

New capabilities should be added without rewriting the engine.

``` mermaid
flowchart LR
    Engine --> CapabilityContract
    NewCapability --> CapabilityContract
```

But do not abuse plugins. Extension points are themselves architecture
and need versioning, permissions, and lifecycle rules.

------------------------------------------------------------------------

## 7. Interface segregation

Do not create one giant interface:

``` ts
interface AncientEverything {}
```

Split contracts by consumers.

``` ts
ExecutionReader
ExecutionWriter
ExecutionController
ExecutionObserver
```

The same rule applies to errors: resist the temptation to build one
`AncientError` class with forty optional fields. `ErrorEnvelope` (Layer
20) is intentionally small and closed; anything capability- or
provider-specific belongs in its typed `raw` payload, not as new
top-level fields.

------------------------------------------------------------------------

## 8. Law of Demeter

A subsystem should not navigate through multiple unrelated objects.

Bad:

``` text
execution.session.user.workspace.provider.client
```

This exposes internal structure and creates coupling.

Prefer dedicated queries or services.

------------------------------------------------------------------------

## 9. Stable interfaces, unstable implementations

The longer-lived the abstraction, the smaller and clearer its contract
should be.

``` text
Capability.execute()
```

is more stable than a contract exposing every internal scheduler and
model detail.

------------------------------------------------------------------------

## 10. Architectural symmetry

Equivalent concepts should behave equivalently.

If one execution supports:

``` text
start
pause
resume
cancel
observe
```

other execution strategies should follow the same lifecycle unless
there is a documented reason not to. The same symmetry applies to
failure: every strategy must expose the same `StrategyFailurePolicy`
shape (Layer 4) even if the numbers inside it differ.
