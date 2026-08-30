# Layer 20 --- Error and Failure Model

## Purpose

Before this document, error handling in ANCIENT was correct advice
scattered across many layers: Layer 12 (mechanisms), Layer 5
(capability errors), Layer 19 (provider errors), Layer 2 (gateway
mapping). That is still true --- but all of it now derives from **one
closed taxonomy and one envelope shape**, defined here. No other layer
is allowed to invent a new error shape; they consume this one.

``` text
Principle: an error is data, not an accident.
It has a type, a cause, a blast radius, and a known next action.
```

------------------------------------------------------------------------

## 1. The canonical envelope

Every failure anywhere in the system --- gateway, engine, strategy,
capability, provider, infrastructure --- is represented as one shape:

``` ts
interface ErrorEnvelope {
  code: ErrorCode                 // closed enum, see Section 2
  domain: ErrorDomain              // which layer originated it
  message: string                  // internal, may contain detail
  clientMessage?: string            // safe-for-client summary, set by Gateway
  transient: boolean                // is this expected to succeed if retried unchanged?
  retryableAsIs: boolean            // false unless the failing operation is idempotent
  partialEffect: 'none' | 'unknown' | 'occurred'  // did a side effect happen before failure?
  blastRadius: 'step' | 'strategy' | 'execution' | 'tenant' | 'platform'
  executionId?: string
  stepId?: string
  capabilityId?: string
  providerId?: string
  traceId: string                   // always present; the thread through Layer 7 observability
  occurredAt: string                 // ISO 8601
  attempt: number                    // 1-indexed; which retry attempt produced this
  cause?: ErrorEnvelope              // chained cause, for wrapped errors
  raw?: unknown                      // original error object; log-only, scrubbed of secrets,
                                       // NEVER serialized to a client response
}

type ErrorDomain =
  | 'edge' | 'auth' | 'gateway' | 'engine' | 'strategy'
  | 'capability' | 'provider' | 'infrastructure' | 'policy'
```

This is a **versioned** contract (`ErrorEnvelope.v1`). Additive fields
are allowed in minor versions; removing or repurposing a field requires
a major version and a migration note in Layer 09.

------------------------------------------------------------------------

## 2. The closed `ErrorCode` taxonomy

Codes are grouped by domain and are a closed set --- adding a new code
requires an ADR (Layer 10), not an ad-hoc string in a `catch` block.

``` text
EDGE_*
  EDGE_RATE_LIMITED
  EDGE_OVERLOADED
  EDGE_PAYLOAD_TOO_LARGE
  EDGE_ABUSE_SIGNATURE

AUTH_*
  AUTH_UNAUTHENTICATED
  AUTH_TOKEN_EXPIRED
  AUTH_INSUFFICIENT_SCOPE

POLICY_*
  POLICY_DENIED
  POLICY_APPROVAL_REQUIRED

CONTEXT_*
  CONTEXT_BUDGET_EXCEEDED
  CONTEXT_SOURCE_UNAVAILABLE      # e.g. memory service down -> degrade, don't fail

MODEL_*
  MODEL_TIMEOUT
  MODEL_INVALID_OUTPUT
  MODEL_CONTEXT_OVERFLOW
  MODEL_CONTENT_FILTERED

PROVIDER_*
  PROVIDER_RATE_LIMITED
  PROVIDER_UNAVAILABLE
  PROVIDER_AUTH_FAILED            # e.g. a user's BYOK key is invalid/expired
  PROVIDER_UNSUPPORTED_CAPABILITY

CAPABILITY_*
  CAPABILITY_TIMEOUT
  CAPABILITY_INVALID_ARGUMENT
  CAPABILITY_EXECUTION_FAILED
  CAPABILITY_SANDBOX_LOST
  CAPABILITY_PARTIAL_EFFECT       # side effect state is unknown/ambiguous

STRATEGY_*
  STRATEGY_BUDGET_EXCEEDED
  STRATEGY_STALLED                # e.g. TEAM_STALL from Layer 4
  STRATEGY_UNRECOVERABLE

INFRA_*
  INFRA_STORAGE_UNAVAILABLE
  INFRA_EVENT_LOG_WRITE_FAILED
  INFRA_SECRETS_UNAVAILABLE

CONFLICT_*
  CONFLICT_VERSION_MISMATCH
  CONFLICT_DUPLICATE_IDEMPOTENCY_KEY

SYSTEM_*
  SYSTEM_UNKNOWN                  # last resort; every occurrence is a bug ticket,
                                    # not an acceptable steady-state code
```

`SYSTEM_UNKNOWN` existing is intentional --- unclassified failures will
happen --- but its rate must be tracked and alerted on. A rising
`SYSTEM_UNKNOWN` rate means the taxonomy is missing a code, not that
the system is fine.

------------------------------------------------------------------------

## 3. Decision table --- what happens automatically

  ErrorCode family     transient   retryableAsIs default   Automatic action
  --------------------- ----------- ------------------------ --------------------------------------------
  EDGE_*                yes         n/a                      Reject with `retryAfterMs`, no retry by server
  AUTH_*                 no          n/a                      Fail immediately, surface to client
  POLICY_*                no          n/a                      Fail immediately (expected outcome, not incident)
  CONTEXT_*               yes         n/a                      Degrade (Layer 12.10), continue execution
  MODEL_TIMEOUT           yes         yes (stateless call)     Retry with backoff, then provider fallback (Layer 19)
  MODEL_INVALID_OUTPUT    yes         yes                      Retry once with corrective prompt
  PROVIDER_RATE_LIMITED   yes         yes                      Retry w/ backoff; circuit breaker counts it
  PROVIDER_UNAVAILABLE    yes         yes                      Circuit breaker opens; fallback chain (Layer 19)
  PROVIDER_AUTH_FAILED    no          no                       Fail; surface "reconnect your API key" to user
  CAPABILITY_TIMEOUT      yes         only if `idempotent`     Retry if idempotent, else compensate
  CAPABILITY_PARTIAL_EFFECT no        no                        Verify actual state before any further action
  STRATEGY_BUDGET_EXCEEDED no          n/a                      Checkpoint, pause, surface for user decision
  INFRA_STORAGE_UNAVAILABLE yes        n/a                      Reconnect w/ backoff; pause execution, don't fail it
  CONFLICT_*               no          n/a                      Route to merge policy (Layer 14.5) or human review

------------------------------------------------------------------------

## 4. Blast-radius containment rule

``` mermaid
flowchart TD
    E[Error occurs] --> B{blastRadius}
    B -->|step| Contain1[Handled inside the strategy step; execution continues]
    B -->|strategy| Contain2[Strategy fails or re-selects; other executions unaffected]
    B -->|execution| Contain3[This execution fails/pauses; tenant unaffected]
    B -->|tenant| Contain4[This tenant degrades; platform unaffected]
    B -->|platform| Contain5[Incident: paging, status page, all tenants notified]
```

**Rule:** a failure must never be allowed to escalate its own blast
radius silently. A single capability timeout (`step`) must not be
permitted to take down an entire tenant's traffic unless it is
correctly re-classified (with evidence) as an infrastructure-level
failure. This is enforced by construction: bulkheads (Layer 12.9) scope
resource pools per provider/tenant/capability-kind specifically so one
`step`-level failure cannot physically consume resources needed by
unrelated executions.

------------------------------------------------------------------------

## 5. Compensation model

For capabilities where `reversible: true`, a compensation action is a
first-class, registered counterpart to the original capability:

``` ts
interface Compensation {
  forCapabilityId: string
  compensate(effectRecord: EffectRecord): Promise<CompensationResult>
}

interface EffectRecord {
  capabilityId: string
  executionId: string
  input: unknown
  occurredAt: string
  verifiedState?: unknown     // result of re-checking actual system state
}

interface CompensationResult {
  outcome: 'compensated' | 'compensation_failed' | 'not_needed'
}
```

For capabilities where `reversible: false` (e.g. sending an email,
charging a card), there is no compensation function --- the only valid
paths on `partialEffect !== 'none'` are: verify the real-world state,
or escalate to a human. The architecture must never guess.

------------------------------------------------------------------------

## 6. Mapping to the client (Gateway, Layer 2)

``` ts
function toClientResponse(err: ErrorEnvelope, callerTrust: TrustLevel): GatewayErrorResponse {
  return {
    error: {
      code: err.code,
      message: callerTrust === 'internal' ? err.message : (err.clientMessage ?? genericMessageFor(err.code)),
      retryable: err.transient,
      retryAfterMs: err.transient ? backoffHint(err) : undefined,
      traceId: err.traceId,
    },
  }
}
```

`genericMessageFor(code)` is a small, reviewed lookup table --- not a
place for stack traces, provider names, or internal identifiers to leak
through by accident.

------------------------------------------------------------------------

## 7. What every other layer owes this document

``` text
Layer 2  (Gateway)        -> uses Section 6 exclusively for client responses
Layer 3  (Engine)         -> writes ErrorEnvelope.executionId/stepId, owns terminal state
Layer 4  (Strategies)     -> classifies STRATEGY_* codes, respects blast-radius rule
Layer 5  (Capabilities)   -> declares idempotent/reversible; produces CAPABILITY_* codes
Layer 6  (Infrastructure) -> produces INFRA_* codes; never invents its own shape
Layer 12 (Reliability)    -> implements the mechanisms this document's decision
                              table refers to (retry, circuit breaker, checkpoint)
Layer 13 (Security)       -> enforces Section 6's trust-level scrubbing
Layer 19 (Providers)      -> produces PROVIDER_* codes; owns the fallback chain
```

If a layer needs a failure behavior this document does not cover, the
fix is to extend this document (with an ADR), not to invent a local
error shape.

------------------------------------------------------------------------

## AS-BUILT status (2026-08-30) --- wired vs. unwired

`@ANCIENT/contracts/src/error.ts` is the canonical envelope + closed
`ErrorCode` taxonomy + `isTransientCode` decision table, and it is now
the only error shape transported across the execute path:

| Owed by (Section 7) | As-built | Where |
| ------------------- | -------- | ----- |
| Layer 3 (Engine) owns terminal state + writes classification | **wired** | `execution/src/engine.ts` -- Lifecycle Manager; `execution/src/types.ts` `RunResult.lastError?` |
| Layer 4 (Strategies) classifies `STRATEGY_*` via envelope | **wired** | `strategies/src/errors.ts` (`asEnvelope`/`isEnvelope`), `agent-loop.ts` (`STRATEGY_BUDGET_EXCEEDED`), `subagents.ts`, `registry.ts` (`STRATEGY_UNRECOVERABLE`) |
| Layer 5 (Capabilities) produces `CAPABILITY_*` / `POLICY_*` typed codes | **wired** | `capabilities/src/core/execute.ts` -- every central-edge verdict carries `CapabilityFailure {code, transient, retryableAsIs, partialEffect}` (parse `CAPABILITY_INVALID_ARGUMENT`, policy `POLICY_DENIED`, consent `POLICY_APPROVAL_REQUIRED`, executor `CAPABILITY_EXECUTION_FAILED`) |
| Layer 6 (Infrastructure) `INFRA_*` codes | **partially wired** | `infrastructure/backpressure` emits `EDGE_OVERLOADED`; event-log/storage failure codes exist in the taxonomy but no producer yet |
| Layer 12 (Reliability) implements the decision table | **wired** | `reliability/src/retry.ts` (`nextDelay`, `withRetry`), `circuit-breaker.ts`, `backpressure.ts` |
| Section 3 auto-action: retry vs. terminal | **wired in engine** | transient codes retry (bounded budget + `execution.retrying`), non-transient settle; policy denials inside a strategy are absorbed as `ok:false` tool results, never escaped as fatal |
| Section 6 `toClientResponse` (trust scrubbing) | **gateway-projected** | `server/src/executions/bridge.ts` `#clientError` maps `clientMessage ?? message`, `code`, `transient→retryable`, `traceId` onto the wire `errorEnvelopeSchema`; the full `callerTrust` logic (Layer 2/13) is not yet applied at the REST edge |
| Section 5 compensation model | **not wired** | no registered compensations; `partialEffect` is carried and honored (conservative "no blind retry") but nothing compensates yet |
| `cause` chaining + `SYSTEM_UNKNOWN` rate alerting | **not wired** | taxonomy + `asEnvelope` passthrough ready; cause-linking and observability alerting are open |
