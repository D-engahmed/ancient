# Layer 19 --- Model & Provider Harness

## Purpose

Every experience (Coding, Design, Cowork, API) must be able to run on
**any model, from any provider, including a user-supplied free API
key**, without the execution engine, strategies, or capabilities ever
knowing which provider is underneath --- and without a provider outage,
rate limit, or bad key ever breaking a running execution.

This document is the concrete design for **Layer 6.1 Providers**. It is
shaped by two pieces of prior art that solved a narrower version of this
problem well, without adopting either directly:

-   **Pi** proves a small harness can support many providers --- including
    free-tier and self-hosted OpenAI-compatible endpoints --- through one
    unified call surface, while keeping sessions portable enough to
    switch providers mid-conversation.
-   **DeepSeek Harness** proves a "no privileged core" plugin
    microkernel can make the model itself just one swappable plugin
    among tools, sandboxes, and sessions --- so adding a provider is an
    install, not a code change.

ANCIENT adopts the two invariants they demonstrate:

``` text
1. Model access is a contract, not a vendor SDK call.
2. A provider is a plugin, not a special case in the core.
```

------------------------------------------------------------------------

## The problem this prevents

Naively, "support any model from any provider" turns into:

``` text
if (provider === 'anthropic') { ... }
else if (provider === 'openai') { ... }
else if (provider === 'deepseek') { ... }
else if (provider === 'user-byok-ollama') { ... }
```

This violates Principle 3 (one source of truth for provider selection)
and Principle 5 (provider becomes a free-text string instead of a
closed, checked contract). It also means every new free-tier or local
model requires touching Execution, Strategy, and Gateway code ---
exactly what Layer 6.1 already forbids: *"Provider code must not leak
into strategies."*

------------------------------------------------------------------------

## Architecture

``` mermaid
flowchart TB
    Engine[Execution Engine] --> ModelRuntime[Model Runtime]
    ModelRuntime --> Registry[Provider Registry]
    Registry --> P1[Anthropic Plugin]
    Registry --> P2[OpenAI Plugin]
    Registry --> P3[DeepSeek Plugin]
    Registry --> P4[Local / OpenAI-compatible Plugin]
    Registry --> P5[Free-Tier / BYOK Plugin]
    Registry --> Pn[... any future plugin]

    ModelRuntime --> Policy[Model Policy]
    ModelRuntime --> CB[Circuit Breaker / Fallback]
```

The Model Runtime (Layer 3.4) is reframed as a **microkernel**: it owns
routing, policy, and fallback, and holds zero provider-specific code.
Every provider --- including "a free API key a user pasted in" --- is a
plugin implementing one contract.

------------------------------------------------------------------------

## Unified provider contract

``` ts
interface ModelProviderPlugin {
  id: string                      // "anthropic", "openai", "deepseek",
                                   // "ollama-local", "byok:<user-id>:<vendor>"
  capabilities: ModelCapability[] // text, vision, tool-use, reasoning, embeddings...
  auth: AuthMode                  // 'api-key' | 'oauth' | 'local' | 'none'
  listModels(): Promise<ModelDescriptor[]>
  complete(req: CompletionRequest): AsyncIterable<CompletionEvent>
  costModel?: CostModel
  healthCheck(): Promise<ProviderHealth>
}

interface ModelDescriptor {
  providerId: string
  modelId: string
  contextWindow: number
  capabilities: ModelCapability[]
  pricing?: { input: number; output: number }
}
```

Every plugin --- first-party (Anthropic, OpenAI, DeepSeek) or
third-party (a self-hosted vLLM box, a free-tier key a user pasted into
Settings) --- loads the same way. The engine never imports a vendor SDK
directly; it only ever imports `ModelProviderPlugin`.

------------------------------------------------------------------------

## Provider Registry (Layer 5 + Layer 6.1 fusion)

``` text
Registry responsibilities:
  discover installed provider plugins
  validate each against the contract at load time
  expose listModels() across all plugins as one catalogue
  track live health per provider
  track per-user / per-workspace credentials (BYOK)
```

BYOK and free API keys are **not** a special code path --- they are just
another `ModelProviderPlugin` instance, scoped to one user or
workspace, with `auth: 'api-key'` and credentials pulled from the
Security layer's scoped-credential store (Layer 6.5 / Layer 13.6),
never logged, never placed in a checkpoint.

------------------------------------------------------------------------

## Model policy --- how a model actually gets picked

``` ts
interface ModelPolicy {
  requiredCapabilities: ModelCapability[]
  preferredProviders?: string[]     // e.g. user's own key first, if present
  costCeiling?: number
  latencyCeiling?: number
  fallbackChain: string[]           // ordered provider/model ids
}
```

``` mermaid
flowchart TD
    Task --> Cap{Capability match?}
    Cap -->|multiple candidates| UserKey{User has own key for a candidate?}
    UserKey -->|Yes| UseUserKey[Prefer user's BYOK provider]
    UserKey -->|No| Cheapest[Pick cheapest provider meeting policy]
    Cap -->|no candidates| Reject[Reject: no capable provider]
```

This keeps "the user can choose any model, even a free key" a
first-class, policy-driven outcome instead of a UI-only toggle --- the
same policy engine that governs cost governs provider choice.

------------------------------------------------------------------------

## Working "without breaking, without feeling it"

This is Layer 12 (Reliability) applied specifically to providers:

``` text
Per-provider circuit breaker   → one dead/rate-limited provider never
                                  blocks the others
Automatic fallback chain       → mid-execution provider swap on failure,
                                  same session, same execution id
Context handoff on swap        → context manager re-serializes context
                                  into the new provider's format;
                                  strategy and capabilities are untouched
Checkpoint before swap         → a failed model call never loses agent
                                  progress (Layer 12.6)
Graceful degradation           → premium model unavailable → approved
                                  fallback model (Layer 12.10)
```

The person using the product should only ever notice: the response was
a little slower, or a small "switched model" note --- never a crash,
never a restarted session, never a re-typed prompt.

------------------------------------------------------------------------

## Session portability

``` ts
interface ExecutionContext {
  providerNeutralHistory: CanonicalMessage[]   // never a vendor-specific format
  activeProvider: string
  compressionState: ContextCompressionState
}
```

Because the context manager (Layer 3.3) stores history in a canonical,
provider-neutral format, and each provider plugin only translates
canonical → vendor format at the moment of the call, switching
providers mid-session --- including moving from a paid model to a
user's free key mid-conversation --- never requires replaying or
re-summarizing the whole history.

------------------------------------------------------------------------

## What this changes in the existing layers

``` text
Layer 3.4  Model Runtime        → becomes a microkernel; zero vendor code
Layer 5    Capability Runtime   → provider plugins register the same way
                                   as tool/skill plugins
Layer 6.1  Providers            → this document is its concrete spec
Layer 12.10 Degradation         → provider fallback is the reference case
Layer 13.4 Capability tokens    → BYOK credentials scoped exactly like
                                   any other capability token
```

------------------------------------------------------------------------

## New assumption register entries (extends Layer 08)

  ID       Assumption                                                          Initial status
  -------- ------------------------------------------------------------------- ------------------------
  A-011    Every provider, incl. BYOK/free-tier, fits one plugin contract      Validate
  A-012    Provider-neutral canonical context makes mid-session swap lossless  Benchmark
  A-013    Per-provider circuit breakers are sufficient bulkheads              Challenge

------------------------------------------------------------------------

## Migration note (extends Layer 09)

``` text
Phase 4.5 — Provider plugin extraction
  Wrap each existing vendor SDK call behind ModelProviderPlugin
  Move every "if provider === x" branch into a per-provider plugin file
  Introduce Provider Registry + Model Policy before adding the next provider
  Only after that: allow user-supplied BYOK keys as first-class plugins
```

## Stop conditions (extends Layer 09)

Stop and review if:

-   a provider plugin needs to know about Strategy or Experience code
-   BYOK credentials appear in logs, prompts, or checkpoints
-   a provider outage produces a visible session restart instead of a
    silent fallback
