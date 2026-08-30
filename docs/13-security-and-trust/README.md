# Security and Trust Architecture

## 1. Trust boundaries

Draw trust boundaries before adding more tools.

``` mermaid
flowchart LR
    User --> Gateway
    Gateway --> TrustedCore
    TrustedCore --> Sandbox
    Sandbox --> External[External Systems]
```

Each boundary requires explicit validation.

------------------------------------------------------------------------

## 2. The model is not the security boundary

The model may generate unsafe instructions.

Security must be enforced outside the model through:

-   capability policy
-   sandboxing
-   credentials
-   approval gates
-   tenant isolation

------------------------------------------------------------------------

## 3. Least privilege

An execution receives only the capabilities required.

Bad:

``` text
coding task -> unrestricted shell + browser + production credentials
```

Good:

``` text
coding task -> repository read/write + restricted test runner
```

Least privilege also applies to **error detail**: an execution, and
the client behind it, receives only the amount of failure detail its
trust level warrants. An anonymous caller gets `PROVIDER_UNAVAILABLE`;
an authenticated workspace admin viewing execution traces may get the
full `ErrorEnvelope` including provider name and internal trace id
(Layer 20, Layer 2 sub-layer F).

------------------------------------------------------------------------

## 4. Capability tokens

Capabilities should receive scoped authority.

``` text
Execution A:
  read repository X

Execution B:
  browser access only

Execution C:
  deployment requires approval
```

A retried capability call reuses the *same* scoped token as the
original attempt --- a failure must never be used as an opportunity to
implicitly escalate privilege (Layer 5).

------------------------------------------------------------------------

## 5. Prompt injection boundary

Treat external content as data, not instructions.

``` mermaid
flowchart LR
    ExternalContent --> Sanitization
    Sanitization --> Context
    Context --> Model
```

Do not allow retrieved documents to silently become privileged system
instructions.

------------------------------------------------------------------------

## 6. Secrets

Secrets must not enter:

-   prompts unless unavoidable
-   logs
-   checkpoints
-   model-visible tool output
-   **error envelopes at any trust level** --- a `raw` error payload
    must be scrubbed of credential material before it is even written
    to the internal log, not just before it reaches the client

Use references or scoped credential execution where possible.

------------------------------------------------------------------------

## 7. Auditability

Dangerous actions require a record:

``` text
who
what execution
what capability
what target
what approval
what result
when
```

Every non-retryable failure and every compensation action is itself an
auditable event (Layer 7).

------------------------------------------------------------------------

## 8. Tenant isolation

Never rely only on application-level filtering.

Validate isolation in:

-   queries
-   object storage
-   vector retrieval
-   caches
-   logs
-   background jobs

A cross-tenant data leak surfaced through an error message (e.g. a
stack trace containing another tenant's file path) is still a tenant
isolation failure --- error scrubbing is part of tenant isolation
testing, not a separate concern.
