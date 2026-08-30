# Layer 4 --- Execution Strategies

## Principle

Strategies define **how work is performed**, not what the whole system
is. Every strategy also defines **how it fails**, explicitly, as part
of its contract --- not as an afterthought bolted on after the happy
path.

``` mermaid
flowchart LR
    Execution --> Selector
    Selector --> Direct
    Selector --> AgentLoop
    Selector --> Subagents
    Selector --> Team
    Selector --> Arena
```

## 4.1 Direct

Use when the operation is deterministic or nearly deterministic.

Examples:

-   rename file
-   format code
-   apply explicit transformation

``` mermaid
flowchart LR
    Request --> Capability --> Result
```

**Failure semantics:** a Direct strategy has no internal retry loop of
its own --- any failure is a single `CapabilityError` passed straight to
the orchestrator. Direct is the cheapest strategy and must stay the
simplest to reason about when it fails.

## 4.2 Agent loop

The default intelligent strategy.

``` mermaid
flowchart LR
    Observe --> Think
    Think --> Act
    Act --> Verify
    Verify --> Observe
```

Exit when:

-   goal reached
-   budget exhausted
-   blocked
-   approval required
-   unrecoverable failure

**Failure semantics:** each `Act` step's failure is caught at the loop
level, not the whole-execution level. A single failed tool call becomes
an observation the model can react to (retry differently, ask for
approval, or give up) up to a bounded `maxConsecutiveFailures`. Only
exceeding that bound, or a budget exhaustion, escalates to an
execution-level failure.

``` ts
interface AgentLoopFailurePolicy {
  maxConsecutiveFailures: number   // e.g. 3
  maxTotalFailures: number         // e.g. 8 across the whole run
  onBudgetExceeded: 'fail' | 'checkpoint_and_pause'
}
```

## 4.3 Subagents

Use when tasks can be delegated with bounded interfaces.

``` mermaid
flowchart TB
    Main --> A[Research]
    Main --> B[Implementation]
    Main --> C[Review]
    A --> Main
    B --> Main
    C --> Main
```

Subagents need explicit:

-   task
-   context scope
-   capability policy
-   budget
-   output contract

**Failure semantics:** one subagent's failure must not, by default, fail
the coordinator. The coordinator receives a typed `SubagentResult` that
is explicitly either `success`, `partial`, or `failed`, and decides
whether the overall task can proceed with partial results, needs a
retry of just that subagent, or must fail upward.

``` ts
interface SubagentResult {
  subagentId: string
  outcome: 'success' | 'partial' | 'failed'
  output?: unknown
  error?: ErrorEnvelope
}
```

## 4.4 Teams

Use when coordination is itself part of solving the problem.

``` mermaid
flowchart TB
    Coordinator --> Planner
    Coordinator --> Builder
    Coordinator --> Reviewer
    Planner --> Coordinator
    Builder --> Coordinator
    Reviewer --> Coordinator
```

**Failure semantics:** a team member failure is handled like a subagent
failure, but the Coordinator additionally must decide whether the
*plan* itself needs revision (e.g. Reviewer keeps rejecting Builder's
output --- that is a planning failure, not a tool failure, and should be
classified and logged as `TEAM_STALL` distinctly from a capability
error).

## 4.5 Arena

The most expensive strategy.

Use only for:

-   competing solutions
-   adversarial review
-   consensus requirements
-   explicit protocol-driven collaboration

Arena is **not the default**.

**Failure semantics:** if a participant fails, Arena proceeds with the
remaining participants rather than failing the whole comparison ---
unless fewer than a configured minimum (e.g. 2) remain, in which case
Arena degrades to a single-strategy result and marks the execution
`execution.degraded`, never a silent unannounced downgrade.

## Common strategy services

Every strategy receives:

``` ts
interface StrategyContext {
  executionId: string
  context: ContextHandle
  modelPolicy: ModelPolicy
  capabilityPolicy: CapabilityPolicy
  budget: ExecutionBudget
  cancellation: AbortSignal
  failurePolicy: StrategyFailurePolicy   // NEW: shared shape, see Layer 20
}
```

> **AS-BUILT (2026-08-30):** strategies run on the `StrategyRuntime` port
> (`packages/strategies/src/types.ts`). Tools return `ToolResult` with a
> typed `ToolFailure` (`code/transient/retryableAsIs/partialEffect`);
> strategy-wide failures emit an `error` event carrying the Layer-20
> `ErrorEnvelope` (see `strategies/src/errors.ts`). Teams/Arena remain
> catalogued-but-unwired (`wired:false`), so the selector can never pick
> them. `failurePolicy`/`StrategyFailurePolicy` above are represented by
> the engine's retry classification, not yet a standalone service.

## Selection policy

``` text
Complexity must be earned.
```

A strategy selector should optimize:

``` text
Expected quality
- cost
- latency
- coordination overhead
- failure probability
```

`failure probability` is not a soft consideration --- Layer 16
(Evaluation Harness) must produce a measured failure rate per strategy
per task type, and the selector's weighting should be periodically
recalibrated from that data, not from intuition.
