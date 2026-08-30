# Data and State Design

## 1. State categories

Do not store all state the same way.

``` mermaid
flowchart TB
    State --> Ephemeral
    State --> Durable
    State --> Derived
    State --> Immutable

    Ephemeral --> Runtime
    Durable --> Database
    Derived --> Cache
    Immutable --> EventLog
```

### Ephemeral

May disappear.

### Durable

Must survive restart.

### Derived

Can be rebuilt.

### Immutable

Historical evidence. **This category now explicitly includes every
`ErrorEnvelope` ever produced** --- errors are never overwritten or
deleted, only superseded by a later successful event for the same
step, exactly like any other immutable log entry.

------------------------------------------------------------------------

## 2. State ownership

Each entity needs:

``` text
Owner
Writer rules
Reader rules
Durability level
Retention policy
Recovery semantics
```

------------------------------------------------------------------------

## 3. Event vs state

Current state answers:

``` text
What is true now?
```

Events answer:

``` text
How did we get here?
```

ANCIENT may need both.

``` mermaid
flowchart LR
    EventLog --> Projector
    Projector --> CurrentState
    CurrentState --> Runtime
```

Do not automatically adopt full event sourcing. Use it only where the
audit/recovery value justifies the complexity. Execution failure and
recovery (Layer 12.7) is exactly such a case --- it is the primary
reason the event log exists at all.

------------------------------------------------------------------------

## 4. Artifact design

Artifacts should be first-class.

Examples:

-   generated files
-   patches
-   images
-   designs
-   reports
-   plans

An artifact needs:

``` text
ID
type
owner
execution provenance
version
storage reference
integrity metadata
```

------------------------------------------------------------------------

## 5. Concurrency control

Multiple agents may edit the same resource.

Define:

-   optimistic concurrency
-   locks where justified
-   version checks
-   merge policies
-   conflict ownership

Do not let multi-agent execution discover conflicts only at the final
commit. A version conflict is itself a classified failure
(`CONFLICT_VERSION_MISMATCH`, Layer 20), not a generic error.

------------------------------------------------------------------------

## 6. Schema evolution

Database schemas and persisted execution formats must evolve safely.

Every durable format should have:

``` text
version
migration strategy
backward compatibility policy
```

This applies to `ErrorEnvelope` and `Checkpoint` shapes too --- both are
versioned from day one (Layer 20, Layer 21) since old checkpoints must
remain replayable after a schema change.
