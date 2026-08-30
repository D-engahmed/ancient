# Testing and Validation Architecture

## 1. Test the architecture, not only functions

The most dangerous bugs occur between components.

Test:

``` text
Gateway → Execution
Execution → Strategy
Strategy → Capability
Capability → Persistence
Recovery → Resume
Failure  → ErrorEnvelope → Client-safe response   # NEW
```

------------------------------------------------------------------------

## 2. Test pyramid for ANCIENT

``` mermaid
flowchart TB
    E2E[Small number of end-to-end tests]
    Integration[Integration and contract tests]
    Unit[Many deterministic unit tests]

    E2E --> Integration --> Unit
```

------------------------------------------------------------------------

## 3. Contract tests

Any replaceable implementation should pass the same contract.

Example:

``` text
PostgresExecutionStore
InMemoryExecutionStore
TestExecutionStore
```

All must satisfy the execution-store contract, **including its failure
contract**: e.g. every implementation must throw the same
`STORAGE_UNAVAILABLE` shape on connection loss, not a driver-specific
exception, so upstream retry logic behaves identically regardless of
which store is mounted.

------------------------------------------------------------------------

## 4. Failure injection

Deliberately simulate, as a required (not optional) part of the test
suite:

  Injected failure                     What it must prove
  ------------------------------------- ----------------------------------------------------
  Provider outage (all endpoints down)  Circuit breaker opens; fallback chain engages; no hang
  Provider partial (one model down)     Only that model's traffic reroutes; others unaffected
  Duplicate event delivery              Idempotency key dedupes; no double side effect
  Process restart mid-execution         Recovery plan resumes from last checkpoint correctly
  Database timeout                      Execution pauses, does not silently drop the request
  Corrupted checkpoint                  System detects corruption and fails to `NEEDS_HUMAN`,
                                         never resumes on unverified state
  Cancelled child task                  Parent AbortSignal reaches every registered cleanup
  Non-idempotent capability crash       System re-verifies actual effect before resuming,
                                         never blind-retries

If recovery is never tested, recovery is only theoretical. Each row
above should exist as an automated test that asserts on the resulting
`ErrorEnvelope`/`RecoveryPlan`, not just "the system didn't crash."

------------------------------------------------------------------------

## 5. Replay

Where possible, record execution inputs and replay them.

This enables:

``` text
bug reproduction
regression testing
strategy comparison
provider comparison
failure-path regression testing    # NEW: replay a historical failure and
                                      confirm the new recovery logic
                                      handles it correctly
```

Sensitive information must be redacted, including any `raw` field on a
stored `ErrorEnvelope` before it is used in a shared replay fixture.

------------------------------------------------------------------------

## 6. Evaluation harness

AI systems require behavior evaluation.

For every strategy:

``` text
Task suite
→ run
→ collect outputs
→ score
→ compare
→ regression detect
```

Benchmark:

-   success rate
-   cost
-   latency
-   tool efficiency
-   recovery success
-   **failure-classification accuracy** --- when a synthetic failure is
    injected, does the system report the *correct* `ErrorCode`, or does
    it misclassify a capability error as a provider error (or vice
    versa)? Misclassification silently breaks retry/compensation
    routing even when the surface-level test ("did it crash?") passes.
