# Layer 5 --- Capability Runtime

## Purpose

Capabilities are what the engine is allowed to do --- and every
capability must declare, up front, how it fails.

``` mermaid
flowchart TB
    Engine --> Registry
    Registry --> Policy
    Policy --> Executor

    Executor --> Tools
    Executor --> Skills
    Executor --> MCP
    Executor --> Commands
    Executor --> Browser
    Executor --> Shell
    Executor --> Files
    Executor --> ComputerUse
    Executor --> DesignTools
```

## Capability taxonomy

### Tools

Atomic functions.

``` text
read_file
write_file
run_command
search
```

### Skills

Higher-level reusable workflows.

``` text
security_review
react_component_design
database_migration
```

### MCP

External protocol integration.

### Commands

Explicit user/system actions.

### Computer use

Controlled interaction with external environments.

### Design tools

Canvas, image, layout, component, and UI operations.

## Unified contract

``` ts
interface Capability {
  id: string
  kind: CapabilityKind
  inputSchema: unknown
  outputSchema: unknown
  permissions: string[]
  cost?: CostModel
  timeout?: number
  idempotent: boolean          // NEW: can this be safely retried as-is?
  reversible: boolean          // NEW: can this be undone/compensated?
  errorClass: CapabilityErrorClass  // NEW: declared failure shape, see below
}
```

## Standardized capability error envelope

Every capability, regardless of kind, must fail through the same
shape --- a hand-written tool and a remote MCP server must be
indistinguishable to the orchestrator at the point of failure:

``` ts
interface CapabilityError {
  capabilityId: string
  code: string                 // maps into Layer 20 ErrorCode
  transient: boolean           // network blip vs. structural problem
  retryableAsIs: boolean       // true only if idempotent === true
  partialEffect?: boolean      // did a possibly-irreversible side effect
                                // occur before failure? (Layer 12.4/12.5)
  raw?: unknown                // original error, log-only, never shown to model
}
```

`partialEffect: true` is the single most important field in this
object: it is what prevents the engine from blindly retrying a
`delete_file` or `run_command('deploy')` that may have partially
succeeded. When it is `true` (or unknown), the retry policy in Layer 20
routes to **compensation**, not retry.

## Capability services

### Registry

Discovers available capabilities. Validates that every registered
capability declares `idempotent`, `reversible`, and `errorClass` before
it is allowed to load --- an undeclared capability is rejected at
registration time, not discovered to be dangerous at runtime.

### Policy engine

Determines whether execution is allowed.

### Sandbox manager

Controls isolation. On sandbox failure (crash, resource exhaustion),
the manager reports `SANDBOX_LOST` and the capability is treated as
`partialEffect: unknown` by default --- the safest assumption when a
sandbox dies mid-operation.

### I/O manager

Handles:

-   files
-   network
-   devices
-   process execution

### Approval system

Human approval for dangerous actions. A capability marked
`reversible: false` and above a configured risk threshold must route
through approval regardless of what the model requests --- this is
enforced in the Policy Engine, not left to prompting.

### Error handling

Retries must be capability-aware.

Do not blindly retry:

``` text
delete_file
payment
deployment
```

``` mermaid
flowchart TD
    Fail[Capability fails] --> Idem{idempotent?}
    Idem -->|Yes| Transient{transient?}
    Transient -->|Yes| Retry[Retry with backoff]
    Transient -->|No| Report[Report as terminal capability error]
    Idem -->|No| Partial{partialEffect known false?}
    Partial -->|Yes| Retry
    Partial -->|No / unknown| Compensate[Route to compensation / human approval]
```

## Security rule

A model may request a capability.

It must not automatically receive unrestricted authority, and a
capability that fails must not silently grant a *broader* retry (e.g.
retrying `run_command` with `sudo` after a permission error) --- retries
run with the exact same policy grant as the original attempt.

> **AS-BUILT (2026-08-30):** the central edge
> (`packages/capabilities/src/core/execute.ts`) returns `ExecutionResult`
> with a typed `CapabilityFailure` for every verdict --- arg-parse
> (`CAPABILITY_INVALID_ARGUMENT`), policy deny (`POLICY_DENIED`),
> missing consent (`POLICY_APPROVAL_REQUIRED`), executor throw
> (`CAPABILITY_EXECUTION_FAILED`) --- carrying `transient`,
> `retryableAsIs`, and `partialEffect` so the engine can classify
> retry-vs-compensate without parsing prose. Retries (when any) re-enter
> the same policy grant; nothing here ever re-runs an executor with a
> widened scope.
