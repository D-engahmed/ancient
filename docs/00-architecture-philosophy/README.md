# ANCIENT Architecture Philosophy

This document defines the engineering logic behind the architecture. The
purpose is to prevent ANCIENT from becoming a system that is
architecturally sophisticated but operationally fragile.

> **v2 note:** Failure and error design is no longer scattered across
> layers as prose. It is now a first-class, versioned contract in
> [Layer 20 --- Error and Failure Model](../20-error-and-failure-model/README.md).
> Every other layer in this document set defers to it instead of
> inventing its own error shapes.

## 1. Primary system-design principles

### Principle 1 --- Optimize for change, not for the current diagram

A system is not good because today's feature is clean. It is good when
the next ten changes do not require rewriting the foundation.

``` mermaid
flowchart LR
    Change[New Requirement] --> Stable[Stable Contract]
    Stable --> Local[Local Change]
    Local --> System[System Continues Working]
```

Prefer:

``` text
stable contracts + replaceable implementations
```

over:

``` text
deep knowledge of concrete classes
```

------------------------------------------------------------------------

### Principle 2 --- Explicit boundaries beat implied architecture

Every important subsystem must answer:

-   What does it own?
-   What may call it?
-   What may it call?
-   What state does it own?
-   What state does it only observe?
-   What happens if it fails?

If ownership cannot be explained in one sentence, the boundary is
probably weak. **"What happens if it fails?" is not optional** --- see
Layer 20 for the required shape of that answer.

------------------------------------------------------------------------

### Principle 3 --- One source of truth per concept

Examples:

``` text
Execution lifecycle      → Execution Engine
Capability permissions   → Policy Engine
Provider selection       → Model Runtime
Durable execution state  → Execution Store
Session identity         → Session Service
Error classification     → Error Taxonomy (Layer 20)
```

Avoid:

``` text
Route updates execution state
+
Agent updates execution state
+
UI infers execution state
```

That creates split-brain behavior. The same applies to errors: if the
gateway, the engine, and a capability each invent their own error
shape, the client ends up guessing what actually happened.

------------------------------------------------------------------------

### Principle 4 --- Complexity must be earned

The default path must be simple.

``` mermaid
flowchart TD
    Task --> S{Can a simpler mechanism solve it?}
    S -->|Yes| Simple[Use simpler mechanism]
    S -->|No| Add[Add justified complexity]
    Add --> Measure[Measure improvement]
```

An abstraction needs evidence. A multi-agent protocol needs evidence. A
distributed component needs evidence.

------------------------------------------------------------------------

### Principle 5 --- Make invalid states difficult to represent

Instead of allowing arbitrary strings:

``` ts
status: string
```

prefer explicit transitions.

``` mermaid
stateDiagram-v2
    Created --> Queued
    Queued --> Running
    Running --> Paused
    Paused --> Running
    Running --> Completed
    Running --> Failed
    Running --> Cancelled
```

The architecture should reject impossible transitions before runtime.
This applies equally to errors: an error is not a free-text string, it
is a typed, closed `ErrorCode` (Layer 20).

------------------------------------------------------------------------

### Principle 6 --- Separate policy from mechanism

Example:

``` text
Mechanism:
  run tool

Policy:
  this execution may run this tool
```

Do not bury policy inside random execution code.

------------------------------------------------------------------------

### Principle 7 --- Design for failure as a normal state

Assume:

-   model requests fail
-   providers throttle
-   tools timeout
-   processes crash
-   events duplicate
-   users disconnect
-   execution resumes later

Failure handling is not a secondary feature. It is designed once,
centrally, in Layer 20, and consumed everywhere else.

------------------------------------------------------------------------

### Principle 8 --- Observability is part of functionality

If an execution cannot explain:

``` text
what happened
why it happened
which model was used
which tools were called
what changed
how much it cost
where it failed
```

then the system is not production-grade.

------------------------------------------------------------------------

## 2. Engineering optimization function

ANCIENT should not optimize for one metric.

Conceptually:

``` text
System Quality =
Correctness
+ Reliability
+ Evolvability
+ Security
+ Observability
+ Performance
+ Cost Efficiency
- Unnecessary Complexity
```

A faster architecture that cannot recover is not automatically better.

A more intelligent architecture that costs 10x more is not automatically
better.

------------------------------------------------------------------------

## 3. Architectural test

Before accepting any major design:

``` mermaid
flowchart LR
    Problem --> Assumption
    Assumption --> Evidence
    Evidence --> Alternatives
    Alternatives --> FailureModes
    FailureModes --> Prototype
    Prototype --> Measurement
    Measurement --> Decision
```

No architecture should exist merely because it sounds advanced.
