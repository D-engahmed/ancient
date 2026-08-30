# Layer 1 --- Experiences

## Purpose

Experiences are how users interact with ANCIENT. They are **not
execution engines**.

``` mermaid
flowchart LR
    CLI --> Gateway
    IDE --> Gateway
    Web --> Gateway
    Coding[AI Coding Experience] --> Gateway
    Design[AI Design Experience] --> Gateway
    Cowork[General Work Experience] --> Gateway
    API --> Gateway
```

## Sub-layers

### 1.1 Client shell

Responsibilities:

-   rendering
-   local interaction state
-   input capture
-   output presentation
-   reconnect behavior

Must not own:

-   provider routing
-   agent orchestration
-   execution state machine
-   durable business logic

### 1.2 Experience adapter

Each product translates product-specific actions into a canonical
request.

``` mermaid
flowchart LR
    A[Design UI Action] --> N[Canonical Intent]
    B[CLI Command] --> N
    C[IDE Action] --> N
    N --> D[Execution Request]
```

### 1.3 Domain experience modules

  Experience   Primary workspace
  ------------ -------------------------------------
  Coding       Repository / files / shell / tests
  Design       Canvas / assets / UI state
  Cowork       Documents / tasks / browser / files
  General      Conversation + tools

The domain may add capabilities and context policies, but should not
fork the engine.

## Required contract

``` ts
interface ExperienceRequest {
  intent: string
  workspaceId?: string
  sessionId?: string
  input: unknown
  requestedCapabilities?: string[]
}
```

## Design rule

**One engine, many experiences.**

Do not create:

``` text
CodingEngine
DesignEngine
CoworkEngine
```

unless the underlying execution semantics genuinely diverge.

## Failure modes to prevent

-   UI-specific execution logic
-   duplicated agent loops
-   product-specific provider integrations
-   incompatible session formats
-   features implemented in one experience but impossible to reuse

## How this layer surfaces errors

The client shell **never invents error copy**. Every error a user sees
originates as a typed `ErrorEnvelope` (Layer 20) emitted upstream by the
Gateway or Engine. The Experience adapter's only job is to map
`ErrorCode` → a UI treatment:

``` ts
interface ErrorPresentation {
  code: string            // matches Layer 20 ErrorCode
  userMessage: string      // human-readable, localized
  retryable: boolean
  suggestedAction?: 'retry' | 'switch_model' | 'reauth' | 'contact_support' | 'none'
}
```

This keeps error *copy* a presentation concern while error *meaning*
stays centrally owned --- see
[Layer 20 --- Error and Failure Model](../20-error-and-failure-model/README.md).
