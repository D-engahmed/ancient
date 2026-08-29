# @ANCIENT/infrastructure

The **bottom base** of the layered ANCIENT architecture (see `docs/ARCHITECTURE.md` §4). Every
other layer leans on this package; it never imports a layer above it (assumption `A-LAYER-002`).

```mermaid
flowchart TB
    subgraph LAYERS["ANCIENT (top → bottom)"]
        direction TB
        EXP["EXPERIENCES (cli)"]
        GW["INTERFACE GATEWAY"]
        ENG["UNIFIED EXECUTION ENGINE"]
        STRAT["EXECUTION STRATEGIES"]
        CAP["CAPABILITY RUNTIME"]
    end

    subgraph INFRA["@ANCIENT/infrastructure (this package — bottom base)"]
        direction TB
        PROV["providers"]
        MEM["memory"]
        STO["storage"]
        EVT["events"]
        SEC["security"]
    end

    subgraph BASE["Cross-cutting base"]
        SHARED["@ANCIENT/shared"]
        DB["@ANCIENT/database"]
    end

    LAYERS --> INFRA
    INFRA --> SHARED
    INFRA --> DB

    style PROV fill:#0f3460,stroke:#7FC4BE,color:#fff
    style MEM fill:#0f3460,stroke:#7FC4BE,color:#fff
    style STO fill:#16213e,stroke:#ff6b6b,color:#fff
    style EVT fill:#16213e,stroke:#ff6b6b,color:#fff
    style SEC fill:#16213e,stroke:#ff6b6b,color:#fff
```

Legend: green-bordered = wired; red-bordered = pending (built in a later sub-branch).

---

## Engineering design

Each sub-layer is an **independent module** (own directory, own exports) added behind its own
sub-branch under `sub/07/*`, then merged into `layer/07-infrastructure`. They share two rules:

1. **Dependency-light** — a sub-layer depends only on `@ANCIENT/shared` (types/data) and node
   builtins. No DB or AI-SDK coupling, so the logic is unit-testable and reusable by every layer
   above.
2. **Own behavior, not data** — provider *data* (catalog, pricing) lives in `@ANCIENT/shared`;
   infrastructure owns provider *behavior*. Shared data → infra → engine → strategies → gateway.

---

## Sub-modules

### providers — done (commit `8efd708`)

Canonical provider runtime: BYOK keys, routing, fallback, circuit breaker, cost.

```mermaid
flowchart LR
    subgraph PROVIDERS["providers/"]
        direction TB
        CONN["connection.ts<br/>ProviderKeyCipher (AES-256-GCM)<br/>ProviderConnection"]
        BRK["breaker.ts<br/>rate-limit circuit breaker"]
        FALL["fallback.ts<br/>pickHealthyFallback"]
        ROUT["router.ts<br/>classifyPrompt / routeTurn"]
        COST["cost.ts<br/>pricingFor / costFor / sumCosts"]
    end
    subgraph BASE2["Base"]
        SH[-shared: catalog & pricing-]
    end
    PROVIDERS --> SH
    BRK --> FALL
```

Files: `connection.ts` (BYOK cipher), `breaker.ts`, `fallback.ts`, `router.ts`, `cost.ts`,
`routing-settings.ts`, `providers.test.ts` (16 tests).

### memory — done (commit `06604d7`)

Project/user memory (`ANCIENT.md`, the CLAUDE.md-equivalent) loaded into the system prompt.

```mermaid
flowchart LR
    U["~/.ancient/ANCIENT.md<br/>(user)"]
    A["ancestor/ANCIENT.md"]
    P["cwd/ANCIENT.md<br/>(project — highest)"]
    L["loadMemory()"]
    B["buildMemoryPromptBlock()"]
    U --> L
    A --> L
    P --> L
    L --> B
```

Files: `types.ts`, `loader.ts` (`loadMemory`, `buildMemoryPromptBlock`), `memory.test.ts` (6 tests).

---

## Roadmap

| Sub-layer | Status | Branch |
|-----------|--------|--------|
| `providers` | done | `sub/07/01-providers` |
| `memory` | done | `sub/07/02-memory` |
| `storage` | in progress | `sub/07/03-storage` |
| `events` | pending | `sub/07/04-events` |
| `security` | pending | `sub/07/05-security` |

## Verification

- `npm run typecheck` exit 0.
- Full suite green (52 baseline + infrastructure additions).
