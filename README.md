# 📘 ANCIENT — Software Documentation
**AI Coding Agent | Terminal UI | Bun/TypeScript/React Monorepo**

---

## 1. Executive Overview

**ANCIENT** is a self-hosted AI coding agent designed to replace per-seat subscription costs for AI coding assistants. It consists of a terminal-based UI (`packages/cli`), an API server (`packages/server`), a shared type/schema library (`packages/shared`), and a Prisma-based database layer (`packages/database`).

**Core Philosophy:** Instead of paying per seat for hosted AI tools, ANCIENT runs locally (or self-hosted) using free/open-weight models (e.g., `mistralai/devstral-2512:free` via OpenRouter) with an agentic loop, built-in tools, MCP support, subagents, and session persistence.

---

## 2. Repository Structure

```
ancient/
├── .env.example              # Environment variable template
├── .gitignore                # Root ignore rules
├── README.md                 # Project overview and architecture target
├── bun.lock                  # Bun lockfile (monorepo dependency graph)
├── docker-compose.yml        # Infrastructure orchestration (Postgres + App)
├── package.json              # Root workspace configuration
├── tsconfig.base.json        # Shared TypeScript compiler options
└── packages/
    ├── cli/                  # Terminal UI (Bun, TypeScript, React, Ink)
    ├── database/             # Prisma ORM, schema, migrations, seed
    ├── server/               # FastAPI-style HTTP API (Bun/Hono)
    └── shared/               # Cross-package types, Zod schemas, constants
```

---

## 3. Package-Level Documentation

### 3.1 `packages/cli` — Terminal UI Application

**Role:** The primary user interface. A terminal application built with React and Ink (React for terminals) that provides screens, layouts, dialogs, theming, and keyboard shortcuts.

**Key Technologies:** Bun, TypeScript, React, Ink, OpenTUI

**Entry Point:** `src/index.tsx` → renders the root layout and mounts the Ink app.

**Binary:** `bin/ANCIENT` — executable shell script that invokes the CLI.

#### File Inventory & Logic

| File | Type | Logic & Responsibility |
|------|------|------------------------|
| `package.json` | Config | Declares `@ANCIENT/cli` name, dependencies on `ink`, `react`, `zod`, `ai`, and internal workspace deps (`@ANCIENT/database`, `@ANCIENT/shared`). Defines build/dev scripts. |
| `tsconfig.json` | Config | Extends `tsconfig.base.json`, sets `jsx: react-jsx` for Ink components. |
| `bin/ANCIENT` | Shell | Executable entry script. Sets up the runtime environment and invokes `bun run src/index.tsx` (or compiled output). |
| `src/index.tsx` | Entry | Bootstraps the Ink renderer. Wraps the app in providers (Theme, Dialog, Toast, Keyboard-layer, Prompt-config) and mounts `<RootLayout />`. |
| `src/theme.ts` | Theme | Defines color tokens, spacing, and terminal-friendly theme variants (dark/light) used across all UI components. |
| `src/layouts/root-layout.tsx` | Layout | Top-level layout shell. Manages screen routing state (home, session, new-session) and renders the active screen. |
| `src/layouts/themed-root.tsx` | Layout | Wraps `RootLayout` with the theme provider context, ensuring all children inherit color/spacing tokens. |
| `src/screens/home.tsx` | Screen | Landing screen. Lists existing sessions, provides entry points to create new sessions or resume old ones. |
| `src/screens/new-session.tsx` | Screen | Configuration screen for starting a new agent session (model selection, agent type, initial prompt). |
| `src/screens/session.tsx` | Screen | The main chat interface. Renders message history, input bar, status bar, and handles real-time streaming from the server. |
| `src/components/header.tsx` | UI | Displays session title, current model, and connection status at the top of the terminal window. |
| `src/components/input-bar.tsx` | UI | User input component. Captures keystrokes, handles submit, and may trigger command-menu on special key sequences. |
| `src/components/status-bar.tsx` | UI | Bottom bar showing agent state (idle, thinking, tool-running), token usage, and keyboard shortcuts. |
| `src/components/spinner.tsx` | UI | Animated loading indicator for "agent is thinking" states. |
| `src/components/session-shell.tsx` | UI | Wrapper component for the session screen that manages layout geometry (header + messages + input + status). |
| `src/components/border.tsx` | UI | Decorative border component using Ink's `<Box>` with unicode border characters. |
| `src/components/dialog-search-list.tsx` | UI | Reusable searchable list widget used inside dialogs (e.g., filtering models or sessions). |
| `src/components/messages/index.tsx` | UI | Message list container. Maps over session messages and renders `<UserMessage>` or `<BotMessage>` accordingly. |
| `src/components/messages/user-message.tsx` | UI | Renders user prompts with right-alignment or distinctive styling. |
| `src/components/messages/bot-message.tsx` | UI | Renders agent responses, including markdown-like formatting, code blocks, and tool call annotations. |
| `src/components/messages/error-message.tsx` | UI | Displays error states (API failures, tool errors) with red styling. |
| `src/components/dialogs/index.tsx` | UI | Dialog host/container. Manages which dialog is currently open (agents, models, sessions, theme). |
| `src/components/dialogs/agents-dialog.tsx` | UI | Modal for selecting/configuring subagents (codebase investigator, code reviewer). |
| `src/components/dialogs/models-dialog.tsx` | UI | Modal for switching LLM providers/models. Fetches available models from the server. |
| `src/components/dialogs/sessions-dialog.tsx` | UI | Modal for browsing, searching, and loading saved sessions from the database. |
| `src/components/dialogs/theme-dialog.tsx` | UI | Modal for switching terminal color themes. |
| `src/components/command-menu/index.tsx` | UI | Command palette (⌘K-style) overlay. Provides quick access to actions without leaving the keyboard. |
| `src/components/command-menu/commands.tsx` | UI | Static command definitions (e.g., "New Session", "Switch Model", "Toggle Theme"). |
| `src/components/command-menu/types.ts` | Types | TypeScript interfaces for command objects (id, label, shortcut, action handler). |
| `src/components/command-menu/filter-commands.ts` | Logic | Fuzzy filtering logic for the command palette search input. |
| `src/components/command-menu/use-command-menu.ts` | Hook | Manages command menu state (open/close, selected index, filter text) and keyboard shortcuts. |
| `src/components/dev/render-guard.tsx` | Dev | Development-only component that catches render errors and prevents full crash loops during hot reload. |
| `src/hooks/use-chat.ts` | Hook | Core chat state management hook. Handles sending messages to the server SSE endpoint, accumulating streamed tokens, and updating local message history. |
| `src/lib/api-client.ts` | Lib | Typed HTTP client (likely wraps `fetch` with Zod validation) for calling `packages/server` REST endpoints. |
| `src/lib/auth.ts` | Lib | Client-side authentication helpers: token storage (in `~/.ancient/`), login state, logout. |
| `src/lib/oauth.ts` | Lib | OAuth flow initiator. Opens browser for provider auth and captures callback tokens. |
| `src/lib/http-errors.ts` | Lib | Error class definitions and retry logic for handling network failures or 4xx/5xx responses. |
| `src/lib/local-tools.ts` | Lib | Client-side tool definitions that map to server tool endpoints, used to render tool call UIs. |
| `src/providers/theme/index.tsx` | Provider | React Context provider for theme tokens. Provides `useTheme()` hook to descendants. |
| `src/providers/dialog/index.tsx` | Provider | Context provider for dialog stack state. Exposes `openDialog()`, `closeDialog()`, `activeDialog`. |
| `src/providers/dialog/types.ts` | Types | Dialog state TypeScript definitions. |
| `src/providers/toast/index.tsx` | Provider | Toast notification system for ephemeral success/error messages in the terminal. |
| `src/providers/toast/types.ts` | Types | Toast severity levels and timeout configurations. |
| `src/providers/prompt-config/index.tsx` | Provider | Holds the current session's prompt configuration (system prompt overrides, temperature, max tokens). |
| `src/providers/Keyboard-layer/index.tsx` | Provider | Global keyboard event listener. Maps key combinations (e.g., `Ctrl+K`, `Esc`) to command menu or dialog toggles. |

---

### 3.2 `packages/server` — API & Agent Runtime

**Role:** HTTP API server that handles authentication, chat streaming (SSE), session CRUD, provider connections, and tool execution. Serves as the bridge between the CLI UI and the LLM/agent logic.

**Key Technologies:** Bun, Hono (or similar lightweight HTTP framework), Zod, AI SDK (Vercel)

**Entry Point:** `src/index.ts` — starts the HTTP server and mounts route handlers.

#### File Inventory & Logic

| File | Type | Logic & Responsibility |
|------|------|------------------------|
| `package.json` | Config | Server dependencies: `hono`, `@ai-sdk/*`, `zod`, `prisma` (via `@ANCIENT/database`). |
| `tsconfig.json` | Config | Server-specific TS config, strict mode for API safety. |
| `src/index.ts` | Entry | Creates HTTP server, applies CORS/auth middleware, mounts `/auth`, `/chat`, `/sessions`, `/provider-connections` routers. Starts listening on `PORT` from env. |
| `src/system-prompt.ts` | Config | Default system prompt template injected into every agent conversation. Defines agent personality, tool usage rules, and safety reminders. |
| `src/routes/auth.ts` | Route | OAuth callback handler, token issuance (JWT), and session cookie management. |
| `src/routes/chat.ts` | Route | **Core agent route.** Accepts POST with messages, streams LLM response via SSE. Invokes the agentic loop: calls LLM → parses tool calls → executes tools → streams results back. |
| `src/routes/sessions.ts` | Route | CRUD for chat sessions: `GET /sessions`, `POST /sessions`, `GET /sessions/:id`, `DELETE /sessions/:id`. Persists via Prisma. |
| `src/routes/provider-connections.ts` | Route | Manages user API keys for LLM providers (OpenAI, Anthropic, OpenRouter). Encrypts keys at rest using `connection-crypto.ts`. |
| `src/middleware/require-auth.ts` | Middleware | Verifies JWT/session token on protected routes. Returns 401 if missing or invalid. |
| `src/middleware/byok-rate-limit.ts` | Middleware | Rate limiting for Bring-Your-Own-Key users to prevent abuse of the server as a proxy. |
| `src/lib/auth.ts` | Lib | Password hashing (bcrypt/argon2), JWT sign/verify, and user lookup utilities. |
| `src/lib/connection-crypto.ts` | Lib | AES-256-GCM encryption/decryption for storing user API keys in the database. Uses master key from env. |
| `src/lib/models.ts` | Lib | Model registry and metadata. Maps model IDs to context windows, pricing, and provider routing logic. |
| `src/lib/provider-connection-validation.ts` | Lib | Validates that a stored API key is still active (makes a cheap test request to the provider). |
| `src/lib/safe-url.ts` | Lib | URL validation helper to prevent SSRF attacks when the agent fetches web resources. |
| `src/lib/dangerous-commands.ts` | Lib | Blocklist/allowlist for shell commands. Flags `rm -rf /`, `mkfs`, `dd`, etc. Requires user approval before execution. |
| `src/lib/fs-safety.ts` | Lib | Filesystem guardrails. Restricts file operations to the project workspace, prevents escaping via `../` traversal. |
| `src/tools/index.ts` | Registry | Exports all built-in tools and registers them with the AI SDK `tool()` helper. Defines the tool schema array passed to the LLM. |
| `src/tools/read-file.ts` | Tool | Reads file contents from disk (with `fs-safety` checks). Returns text or base64 for images. |
| `src/tools/write-file.ts` | Tool | Writes or overwrites files. Requires explicit approval for existing files. |
| `src/tools/edit-file.ts` | Tool | Applies search-and-replace or diff-based edits to existing files. |
| `src/tools/list-directory.ts` | Tool | Returns directory contents (files + subdirs) with metadata. |
| `src/tools/glob.ts` | Tool | Pattern-based file search (e.g., `**/*.ts`). |
| `src/tools/grep.ts` | Tool | Searches file contents for regex/pattern matches across the codebase. |
| `src/tools/bash.ts` | Tool | Executes shell commands in a sandboxed subprocess. Integrates with `dangerous-commands.ts` for safety approval. |

---

### 3.3 `packages/database` — Data Persistence Layer

**Role:** Prisma ORM setup, database schema, migrations, and seed data. Shared across CLI (for local caching) and Server (for primary persistence).

**Key Technologies:** Prisma, PostgreSQL, TypeScript

#### File Inventory & Logic

| File | Type | Logic & Responsibility |
|------|------|------------------------|
| `package.json` | Config | Prisma client generation scripts. Exports `@ANCIENT/database`. |
| `tsconfig.json` | Config | Database package TS configuration. |
| `prisma.config.ts` | Config | Prisma Client configuration (connection pooling, logging, binary targets). |
| `prisma/schema.prisma` | Schema | **Source of truth** for data models: `User`, `Session`, `Message`, `ProviderConnection`, `AgentConfig`, `ToolCall`, `Checkpoint`. Defines relations and indexes. |
| `prisma/migrations/20260802140000_initial_schema/migration.sql` | Migration | Initial table creation: users, sessions, messages. |
| `prisma/migrations/20260802150000_add_provider_connections/migration.sql` | Migration | Adds `ProviderConnection` table for storing encrypted API keys. |
| `prisma/migrations/20260802160000_add_provider_connection_status/migration.sql` | Migration | Adds status/validation fields to provider connections (active, invalid, rate-limited). |
| `seed.ts` | Seed | Populates default data on fresh installs (default admin user, example sessions, built-in model list). |
| `src/client.ts` | Lib | Singleton PrismaClient instance with `$extends` for custom query logging or soft-delete logic. |
| `src/enums.ts` | Lib | TypeScript enum mirrors for Prisma enums (e.g., `MessageRole`, `ProviderType`, `AgentStatus`). |
| `src/index.ts` | Barrel | Re-exports `prisma` client and enums for consumers (`@ANCIENT/database`). |

---

### 3.4 `packages/shared` — Cross-Cutting Types & Schemas

**Role:** Prevents circular dependencies between `cli` and `server` by housing shared Zod schemas, TypeScript types, and provider constants.

**Key Technologies:** TypeScript, Zod

#### File Inventory & Logic

| File | Type | Logic & Responsibility |
|------|------|------------------------|
| `package.json` | Config | Zero-runtime-dependencies package. Used by both CLI and Server. |
| `tsconfig.json` | Config | Strictest TS settings (no emit, type-check only). |
| `src/index.ts` | Barrel | Re-exports all shared modules. |
| `src/schemas.ts` | Schema | Zod schemas for: `ChatMessage`, `SessionConfig`, `ToolCallPayload`, `ProviderCredential`, `UserPreferences`. Used for runtime validation on both client and server. |
| `src/models.ts` | Types | TypeScript interfaces derived from Zod schemas via `z.infer<typeof Schema>`. Includes `ModelInfo`, `AgentType`, `ThemeName`. |
| `src/providers.ts` | Constants | Registry of supported LLM providers (`openai`, `anthropic`, `openrouter`, `google`, `local`). Maps to endpoint URLs and default models. |

---

## 4. Connection & Dependency Graphs (Mermaid)

### 4.1 Monorepo Workspace Dependency Graph

```mermaid
graph TD
    subgraph Root["📁 Root Workspace"]
        R_PKG[package.json<br/> workspaces: packages/]
        R_TS[tsconfig.base.json]
        R_DOCK[docker-compose.yml]
        R_ENV[.env.example]
    end

    subgraph Shared["📦 @ANCIENT/shared"]
        S_IDX[src/index.ts]
        S_SCH[src/schemas.ts]
        S_MOD[src/models.ts]
        S_PRO[src/providers.ts]
    end

    subgraph DB["📦 @ANCIENT/database"]
        D_IDX[src/index.ts]
        D_CLI[src/client.ts]
        D_ENU[src/enums.ts]
        D_PRI[prisma/schema.prisma]
        D_MIG1[migrations/...initial]
        D_MIG2[migrations/...provider]
        D_MIG3[migrations/...status]
        D_SEED[seed.ts]
    end

    subgraph Server["📦 @ANCIENT/server"]
        SRV_IDX[src/index.ts]
        SRV_CHAT[src/routes/chat.ts]
        SRV_AUTH[src/routes/auth.ts]
        SRV_SESS[src/routes/sessions.ts]
        SRV_PROV[src/routes/provider-connections.ts]
        SRV_TOOL[src/tools/index.ts]
        SRV_MID1[src/middleware/require-auth.ts]
        SRV_MID2[src/middleware/byok-rate-limit.ts]
    end

    subgraph CLI["📦 @ANCIENT/cli"]
        CLI_IDX[src/index.tsx]
        CLI_ROOT[src/layouts/root-layout.tsx]
        CLI_HOME[src/screens/home.tsx]
        CLI_SES[src/screens/session.tsx]
        CLI_HK[src/hooks/use-chat.ts]
        CLI_API[src/lib/api-client.ts]
        CLI_OA[src/lib/oauth.ts]
    end

    CLI -->|imports types/schemas| Shared
    CLI -->|imports PrismaClient| DB
    Server -->|imports types/schemas| Shared
    Server -->|imports PrismaClient| DB
    DB -->|references| Shared
    Root -->|orchestrates| CLI
    Root -->|orchestrates| Server
    Root -->|orchestrates| DB
```

---

### 4.2 CLI Internal Component & Provider Network

```mermaid
graph TD
    subgraph Entry["CLI Entry"]
        BIN[bin/ANCIENT]
        IDX[src/index.tsx]
    end

    subgraph Providers["React Context Providers"]
        P_THEME[theme/index.tsx]
        P_DLG[dialog/index.tsx]
        P_TOAST[toast/index.tsx]
        P_KBD[Keyboard-layer/index.tsx]
        P_PROMPT[prompt-config/index.tsx]
    end

    subgraph Layouts["Layouts"]
        L_ROOT[root-layout.tsx]
        L_THEMED[themed-root.tsx]
    end

    subgraph Screens["Screens"]
        SCR_HOME[home.tsx]
        SCR_NEW[new-session.tsx]
        SCR_SES[session.tsx]
    end

    subgraph SessionUI["Session UI Components"]
        C_HEADER[header.tsx]
        C_INPUT[input-bar.tsx]
        C_STATUS[status-bar.tsx]
        C_SHELL[session-shell.tsx]
        C_MSG_IDX[messages/index.tsx]
        C_MSG_U[user-message.tsx]
        C_MSG_B[bot-message.tsx]
        C_MSG_E[error-message.tsx]
    end

    subgraph Dialogs["Dialog System"]
        D_IDX[dialogs/index.tsx]
        D_AGT[agents-dialog.tsx]
        D_MOD[models-dialog.tsx]
        D_SES[sessions-dialog.tsx]
        D_THM[theme-dialog.tsx]
        D_SL[dialog-search-list.tsx]
    end

    subgraph CommandMenu["Command Palette"]
        CM_IDX[command-menu/index.tsx]
        CM_CMD[commands.tsx]
        CM_FL[filter-commands.ts]
        CM_HK[use-command-menu.ts]
    end

    subgraph Lib["Client Libraries"]
        LIB_API[api-client.ts]
        LIB_AUTH[auth.ts]
        LIB_OA[oauth.ts]
    end

    BIN --> IDX
    IDX --> L_THEMED
    L_THEMED --> P_THEME
    L_THEMED --> P_DLG
    L_THEMED --> P_TOAST
    L_THEMED --> P_KBD
    L_THEMED --> P_PROMPT
    L_THEMED --> L_ROOT

    L_ROOT --> SCR_HOME
    L_ROOT --> SCR_NEW
    L_ROOT --> SCR_SES

    SCR_SES --> C_SHELL
    C_SHELL --> C_HEADER
    C_SHELL --> C_MSG_IDX
    C_SHELL --> C_INPUT
    C_SHELL --> C_STATUS

    C_MSG_IDX --> C_MSG_U
    C_MSG_IDX --> C_MSG_B
    C_MSG_IDX --> C_MSG_E

    SCR_SES -->|uses| LIB_API
    SCR_HOME -->|uses| LIB_API
    LIB_API -->|auth headers| LIB_AUTH
    LIB_AUTH -->|token| LIB_OA

    P_KBD -->|triggers| CM_IDX
    CM_IDX --> CM_CMD
    CM_IDX --> CM_FL
    CM_IDX --> CM_HK
    CM_IDX -->|opens| D_IDX

    D_IDX --> D_AGT
    D_IDX --> D_MOD
    D_IDX --> D_SES
    D_IDX --> D_THM
    D_MOD --> D_SL
    D_SES --> D_SL

    P_DLG -->|controls| D_IDX
    P_THEME -->|styles| C_SHELL
    P_TOAST -->|notifies| SCR_SES
```

---

### 4.3 Server API & Agent Runtime Network

```mermaid
graph TD
    subgraph ServerEntry["Server Entry"]
        SRV[src/index.ts]
    end

    subgraph Middleware["Middleware Stack"]
        M_AUTH[require-auth.ts]
        M_RL[byok-rate-limit.ts]
    end

    subgraph Routes["Route Handlers"]
        R_CHAT[chat.ts]
        R_AUTH[auth.ts]
        R_SESS[sessions.ts]
        R_PROV[provider-connections.ts]
    end

    subgraph AgentCore["Agent Core"]
        SYS[system-prompt.ts]
        TOOLS[tools/index.ts]
    end

    subgraph ToolSet["Built-in Tools"]
        T_READ[read-file.ts]
        T_WRITE[write-file.ts]
        T_EDIT[edit-file.ts]
        T_LS[list-directory.ts]
        T_GLOB[glob.ts]
        T_GREP[grep.ts]
        T_BASH[bash.ts]
    end

    subgraph Safety["Safety Layer"]
        SAFE_DANG[dangerous-commands.ts]
        SAFE_FS[fs-safety.ts]
        SAFE_URL[safe-url.ts]
    end

    subgraph Lib["Server Libraries"]
        L_AUTH[lib/auth.ts]
        L_CR[connection-crypto.ts]
        L_MOD[models.ts]
        L_VAL[provider-connection-validation.ts]
    end

    SRV --> M_AUTH
    SRV --> M_RL
    SRV --> R_CHAT
    SRV --> R_AUTH
    SRV --> R_SESS
    SRV --> R_PROV

    R_CHAT -->|protected by| M_AUTH
    R_SESS -->|protected by| M_AUTH
    R_PROV -->|protected by| M_AUTH
    R_PROV -->|rate limited by| M_RL

    R_CHAT --> SYS
    R_CHAT --> TOOLS
    R_CHAT --> L_MOD

    TOOLS --> T_READ
    TOOLS --> T_WRITE
    TOOLS --> T_EDIT
    TOOLS --> T_LS
    TOOLS --> T_GLOB
    TOOLS --> T_GREP
    TOOLS --> T_BASH

    T_BASH --> SAFE_DANG
    T_READ --> SAFE_FS
    T_WRITE --> SAFE_FS
    T_EDIT --> SAFE_FS
    T_LS --> SAFE_FS

    R_PROV --> L_CR
    R_PROV --> L_VAL
    R_AUTH --> L_AUTH

    R_CHAT -->|streams to| CLI_SESSION
    CLI_SESSION[CLI use-chat.ts]
```

---

### 4.4 Database Schema & Migration Flow

```mermaid
graph LR
    subgraph SchemaDef["Schema Definition"]
        PRISMA[prisma/schema.prisma]
    end

    subgraph Migrations["Migration History"]
        M1[20260802140000_initial_schema]
        M2[20260802150000_add_provider_connections]
        M3[20260802160000_add_provider_connection_status]
    end

    subgraph Runtime["Runtime Access"]
        CLIENT[src/client.ts]
        ENUMS[src/enums.ts]
        IDX[src/index.ts]
    end

    subgraph Consumers["Consumers"]
        SRV[Server Routes]
        CLI[CLI Local Cache]
    end

    PRISMA -->|generates| CLIENT
    PRISMA -->|generates| ENUMS

    M1 -->|applied before| M2
    M2 -->|applied before| M3
    M3 -->|matches| PRISMA

    CLIENT -->|exported via| IDX
    ENUMS -->|exported via| IDX

    IDX -->|imported by| SRV
    IDX -->|imported by| CLI
```

---

### 4.5 Data Flow — Chat Session Lifecycle

```mermaid
sequenceDiagram
    participant User
    participant CLI as CLI (Ink UI)
    participant Hook as use-chat.ts
    participant API as api-client.ts
    participant SRV as server/chat.ts
    participant LLM as AI SDK / LLM
    participant DB as database (Prisma)

    User->>CLI: Type message + Enter
    CLI->>Hook: submit(message)
    Hook->>API: POST /chat (SSE)
    API->>SRV: fetch with auth token
    SRV->>DB: Load session history
    SRV->>LLM: streamText({ messages, tools })
    
    loop Agentic Loop
        LLM-->>SRV: Tool call request (e.g., readFile)
        SRV->>SRV: tools/index.ts routes call
        SRV->>SRV: fs-safety.ts validates path
        SRV->>SRV: read-file.ts reads disk
        SRV-->>LLM: Tool result appended
        LLM-->>SRV: Next token / final response
    end

    SRV-->>API: SSE stream (chunks)
    API-->>Hook: onChunk callback
    Hook-->>CLI: Append to message state
    CLI-->>User: Render bot-message.tsx

    SRV->>DB: Save assistant message + tool calls
    SRV->>DB: Update session checkpoint
```

---

### 4.6 Authentication & Provider Connection Flow

```mermaid
graph TD
    subgraph User["User Terminal"]
        U_CLI[CLI Ink App]
        U_OA[lib/oauth.ts]
        U_API[lib/api-client.ts]
    end

    subgraph ServerAuth["Server Auth"]
        S_OAUTH[routes/auth.ts]
        S_JWT[lib/auth.ts]
        S_MID[middleware/require-auth.ts]
    end

    subgraph ProviderKeys["Provider API Keys"]
        R_PROV[routes/provider-connections.ts]
        R_CRYPTO[lib/connection-crypto.ts]
        R_VAL[lib/provider-connection-validation.ts]
        DB_PROV[(ProviderConnection<br/>Table)]
    end

    U_CLI -->|1. Init login| U_OA
    U_OA -->|2. Open browser| OAuthProvider[GitHub/Google OAuth]
    OAuthProvider -->|3. Callback + code| S_OAUTH
    S_OAUTH -->|4. Issue| S_JWT
    S_JWT -->|5. Return token| U_OA
    U_OA -->|6. Store ~/.ancient/| U_API

    U_CLI -->|7. Add API key| U_API
    U_API -->|8. POST /provider-connections| R_PROV
    R_PROV -->|9. Encrypt| R_CRYPTO
    R_PROV -->|10. Validate| R_VAL
    R_PROV -->|11. Save| DB_PROV

    U_API -->|12. Authenticated request| S_MID
    S_MID -->|13. Verify JWT| S_JWT
    S_MID -->|14. Allow| R_PROV
    R_PROV -->|15. Decrypt key| R_CRYPTO
    R_PROV -->|16. Proxy to LLM| LLMProvider[OpenAI/Anthropic/etc]
```

---

## 5. Reference Lines for Software Documentation

This documentation follows these software documentation standards:

1. **IEEE 830 (Software Requirements Specifications)** — Functional decomposition by package and component.
2. **ISO/IEC/IEEE 42010 (Architecture Description)** — Multiple architectural viewpoints (logical, process, development).
3. **C4 Model (Simon Brown)** — Level 2 (Container) and Level 3 (Component) diagrams rendered in Mermaid.
4. **Diátaxis Framework** — Separation into reference (file inventory), explanation (logic), and how-to (flow diagrams).

---

## 6. Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **Monorepo with Bun workspaces** | Single command to run CLI + Server + DB. Shared code in `packages/shared` prevents duplication. |
| **Prisma in separate package** | Both CLI and Server can query the database without circular dependencies. |
| **React/Ink for Terminal UI** | Familiar component model, declarative rendering, and existing ecosystem (OpenTUI). |
| **SSE for chat streaming** | Server-Sent Events provide low-latency token streaming without WebSocket complexity. |
| **Encrypted provider keys** | `connection-crypto.ts` ensures user API keys are never stored plaintext, even in self-hosted scenarios. |
| **Tool safety at server level** | `dangerous-commands.ts` and `fs-safety.ts` run on the server to prevent malicious prompt injection from bypassing client-side checks. |

---

## 7. Environment & Deployment

**Local Development:**
```bash
bun install          # Installs all workspace packages
bun run dev:server   # Hot-reloads server
bun run dev:cli      # Hot-reloads CLI
```

**Docker (from `docker-compose.yml`):**
- PostgreSQL container for persistence
- Server container exposing HTTP API
- CLI runs natively or inside a container with TTY access

**Required Environment Variables** (from `.env.example`):
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Signing key for auth tokens
- `ENCRYPTION_KEY` — Master key for `connection-crypto.ts`
- `OPENROUTER_API_KEY` — Default provider key (optional if using BYOK)

---

## 8. Status & Migration Notes

As noted in the README, this is a **rebuild of HaMan** with the terminal UI already live and the agent core being merged in. The architecture target shows a planned `packages/agent` directory that does not yet exist in the current tree. The current agent loop lives inside `packages/server/src/routes/chat.ts` and `packages/server/src/tools/` as an interim consolidation step.
