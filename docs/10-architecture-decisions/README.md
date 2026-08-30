# Architecture Decisions

This directory should contain one ADR per major decision.

Recommended format:

``` text
ADR-001-unified-execution-model.md
ADR-002-agent-is-a-strategy.md
ADR-003-capability-contract.md
ADR-004-durable-execution-state.md
ADR-005-context-ownership.md
ADR-006-model-routing-policy.md
ADR-007-multi-agent-selection-policy.md
ADR-008-provider-as-plugin.md
ADR-009-canonical-error-envelope.md
ADR-010-idempotency-and-compensation-model.md
```

## ADR template

``` md
# ADR-XXX — Title

## Status
Proposed | Accepted | Superseded | Rejected

## Context
What problem exists?

## Decision
What are we doing?

## Alternatives
What did we reject and why?

## Consequences
What becomes easier and harder?

## Validation
How will we know this decision was correct?

## Revisit trigger
When must this ADR be reviewed again?
```

## Notes on the two newest ADRs

**ADR-008 (Provider as plugin)** formalizes Layer 19: every model
provider, including BYOK and free-tier keys, is a `ModelProviderPlugin`
instance; the engine holds no vendor-specific code.

**ADR-009 (Canonical error envelope)** formalizes Layer 20: every
failure in the system, regardless of origin, is represented as one
`ErrorEnvelope` shape with a closed `ErrorCode` enum, so the Gateway,
Engine, and Experiences can all reason about failure the same way.

**ADR-010 (Idempotency and compensation model)** formalizes the rule
that a capability's `idempotent` and `reversible` flags --- not developer
intuition at the call site --- determine whether a failure is retried,
compensated, or escalated to human approval.
