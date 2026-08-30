# Reliability and Resilience Design

> This layer is the *mechanism* library. The *taxonomy* it operates on
> (error codes, retryability, blast radius) is defined once in
> [Layer 20 --- Error and Failure Model](../20-error-and-failure-model/README.md).
> Read that document first; this one assumes it.

## 1. Failure taxonomy

Every failure should be classified.

``` mermaid
mindmap
  root((Failure))
    User
      Invalid request
      Permission denied
      Cancellation
    Model
      Timeout
      Invalid output
      Context overflow
    Provider
      Rate limit
      Outage
    Capability
      Tool error
      Timeout
      Side effect failed
    Infrastructure
      Database
      Network
      Process crash
```

A generic `catch (error)` is not a reliability architecture. Every
`catch` block in the codebase must map its error into an `ErrorEnvelope`
with a code from the Layer 20 table before it leaves the function that
caught it.

------------------------------------------------------------------------

## 2. Timeouts

Every external boundary needs a timeout, and every timeout needs an
owner and a budget relationship to its parent.

``` text
Model call        <= strategy step budget      <= execution budget
Tool call          <= strategy step budget      <= execution budget
MCP call           <= strategy step budget      <= execution budget
Database call       <= request budget (gateway)
Browser operation   <= strategy step budget      <= execution budget
```

``` ts
interface TimeoutPolicy {
  boundary: 'model' | 'tool' | 'mcp' | 'database' | 'browser'
  timeoutMs: number
  onTimeout: 'fail' | 'retry_once' | 'escalate_to_execution_budget_check'
}
```

**Rule:** a child timeout must always be strictly shorter than the
remaining parent budget. If `remainingExecutionBudget < childTimeout`,
the child call must not start --- it should fail fast with
`BUDGET_EXCEEDED` rather than start work that cannot possibly complete
in time.

------------------------------------------------------------------------

## 3. Cancellation propagation

Cancellation must flow downward, using one shared `AbortSignal` chain,
not a bespoke boolean flag per subsystem.

``` mermaid
flowchart TB
    UserCancel --> Execution
    Execution --> Strategy
    Strategy --> Subagent
    Strategy --> Tool
    Tool --> Process
```

``` ts
interface CancellationScope {
  signal: AbortSignal
  onCancel(cleanup: () => Promise<void>): void   // register cleanup, always awaited
}
```

A cancelled parent must not leave uncontrolled child processes running.
**Concretely:** every capability that spawns a process, opens a
browser page, or holds a file lock must register a cleanup callback on
the scope's `AbortSignal` at the moment it acquires the resource, not
as an afterthought at the end of a happy-path function.

------------------------------------------------------------------------

## 4. Retry policy

Retry only when the operation is safe --- and "safe" is decided by data
on the object that failed (`idempotent`, `reversible` --- Layer 5), not
by a per-call try/catch guess.

``` mermaid
flowchart TD
    Failure --> T{Transient?}
    T -->|No| Fail
    T -->|Yes| I{Idempotent?}
    I -->|Yes| Retry
    I -->|No| Compensation
```

``` ts
interface RetryBudget {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  jitter: boolean
  backoffMultiplier: number     // e.g. 2.0 for exponential
}

function nextDelay(attempt: number, budget: RetryBudget): number {
  const raw = Math.min(
    budget.maxDelayMs,
    budget.baseDelayMs * Math.pow(budget.backoffMultiplier, attempt)
  )
  return budget.jitter ? raw * (0.5 + Math.random() * 0.5) : raw
}
```

Never blindly retry irreversible side effects. A retry attempt that
exhausts `maxAttempts` does not silently give up --- it emits
`execution.retrying` events throughout (Layer 3) and, on final failure,
produces a terminal `ErrorEnvelope` with the full attempt history
attached for observability.

------------------------------------------------------------------------

## 5. Idempotency

Requests may be duplicated.

The same operation should not create:

``` text
two deployments
two payments
two database migrations
two destructive actions
```

Use idempotency keys for externally visible operations:

``` ts
interface IdempotentRequest {
  idempotencyKey: string   // stable per logical operation, e.g. hash(executionId, stepId)
}
```

**Concretely:** the idempotency key is derived from `(executionId,
stepId)`, not generated fresh per attempt --- a retried step must present
the *same* key every time so the downstream system (payment processor,
deployment API, database) can recognize and dedupe the duplicate.

------------------------------------------------------------------------

## 6. Checkpointing

Checkpoint boundaries should be deliberate.

Good checkpoint candidates:

-   before expensive model work
-   after durable artifact creation
-   after major plan changes
-   before dangerous external side effects

``` ts
interface Checkpoint {
  executionId: string
  sequence: number
  stateSnapshot: unknown      // serialized execution + context state
  createdBefore?: string      // capabilityId, if this checkpoint precedes a risky action
}
```

Avoid checkpointing every token. A reasonable default: checkpoint at
strategy step boundaries and immediately before any capability with
`reversible: false`.

------------------------------------------------------------------------

## 7. Recovery

Recovery must answer:

``` text
What was completed?
What was only planned?
What was in progress?
What can safely resume?
What must be re-run?
```

``` ts
interface RecoveryPlan {
  lastCheckpoint: Checkpoint
  eventsSinceCheckpoint: ExecutionEvent[]   // replayed from the event log (Layer 6.4)
  inFlightAtCrash: { capabilityId: string; idempotent: boolean }[]
  resumeAction: 'replay_from_checkpoint' | 're_verify_then_resume' | 'fail_needs_human'
}
```

An in-flight, non-idempotent capability at the moment of a crash always
routes to `re_verify_then_resume`: before continuing, the system must
check whether the effect actually happened (e.g. "did the file get
written?", "did the deployment go out?") rather than guessing. A
checkpoint without this verification step is only a partial backup.

------------------------------------------------------------------------

## 8. Backpressure

The system must control overload.

``` mermaid
flowchart LR
    Requests --> Queue
    Queue --> Workers
    Workers --> Capacity
    Capacity --> Queue
```

``` ts
interface BackpressurePolicy {
  maxQueueDepth: number
  onQueueFull: 'reject_with_retry_after' | 'shed_lowest_priority'
  perTenantConcurrencyLimit: number
}
```

Without backpressure, increased traffic can collapse the entire system.
A full queue must return `EDGE_OVERLOADED` with a `retryAfterMs`, never
an unbounded hang.

------------------------------------------------------------------------

## 9. Bulkheads

One failing capability or provider should not consume all resources.

``` ts
interface Bulkhead {
  scope: 'provider' | 'tenant' | 'capability_kind'
  maxConcurrent: number
  circuitBreaker: CircuitBreakerConfig
}

interface CircuitBreakerConfig {
  failureThreshold: number      // consecutive or rolling-window failures
  windowMs: number
  openDurationMs: number        // how long to stay open before a trial request
  halfOpenTrialRequests: number
}
```

Examples:

-   per-provider concurrency limits + circuit breaker (Layer 19)
-   per-tenant budgets
-   separate worker pools per capability kind (shell vs. browser vs.
    model calls should never share a pool --- a browser hang must not
    starve shell tool execution)

------------------------------------------------------------------------

## 10. Graceful degradation

When advanced systems fail:

``` text
Arena unavailable
→ fall back to single-agent if policy permits

Premium model unavailable
→ use approved fallback model

Long-term memory unavailable
→ continue with execution-local context
```

Degrade intentionally, not accidentally --- every degradation path is a
named `ErrorCode`-adjacent event (`execution.degraded`, Layer 3) with a
reason, so degraded runs are queryable and their success/quality can be
measured separately from full-capability runs (Layer 16).

------------------------------------------------------------------------

## 11. Failure-mode reference table

  Failure origin              Example                          Default action                      Escalation if exhausted
  --------------------------- --------------------------------- ------------------------------------ ------------------------------
  Provider transient          429 rate limit                    Retry w/ backoff, then fallback chain   Fail execution, `PROVIDER_UNAVAILABLE`
  Provider outage             connection refused                Circuit breaker opens, fallback chain   Degrade to lower-tier model
  Model invalid output        malformed tool call                Retry once with corrective prompt       Fail step, ask model to re-plan
  Capability transient        tool timeout                       Retry per capability's `idempotent` flag Compensation or human approval
  Capability irreversible fail deploy failed mid-way              Verify actual state, compensate         Escalate to human, checkpoint & pause
  Infrastructure              DB connection lost                 Reconnect w/ backoff, queue writes       Pause execution, alert on-call
  User cancellation           explicit cancel                    Propagate `AbortSignal`, cleanup         N/A --- expected, not a failure
  Policy denial               capability not permitted           Return `POLICY_DENIED` immediately      N/A --- expected, not a failure
