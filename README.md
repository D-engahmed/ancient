<div align="center">

<img src="assets/logo-animated.svg" width="100%" alt="ANCIENT Logo">

[![Version](https://img.shields.io/badge/version-3.0.0-8A2BE2?style=flat-square)](https://github.com/D-engahmed/ancient/releases)
[![License](https://img.shields.io/badge/license-Proprietary-ff6b6b?style=flat-square)](LICENSE)
[![Bun](https://img.shields.io/badge/built%20with-Bun-f9f1a5?style=flat-square&logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-Ink-61dafb?style=flat-square&logo=react)](https://github.com/vadimdemedes/ink)

**[Quick Start](#-quick-start)** · **[Features](#-what-makes-ancient-different)** · **[Agent System](#-the-sub-agent-system)** · **[Architecture](#-architecture)** · **[Roadmap](#-roadmap)**

</div>

---

## 🚀 What is ANCIENT?

**ANCIENT** is a self-hosted, terminal-native AI coding agent that replaces per-seat subscription costs with full control over your AI workforce. Unlike Claude Code, Cursor, or GitHub Copilot — ANCIENT lets you **design custom agent teams**, **assign different LLM models to each agent**, and **orchestrate them through 6 coordination protocols** — all from your terminal.

> **Honesty note:** the multi-agent surface below is the *documented intent*. The **as-built**
> reality (what currently runs, what is un-wired, and the state/persistence limits) is recorded
> in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the assumption register
> [`docs/architecture/ASSUMPTIONS.md`](docs/architecture/ASSUMPTIONS.md). Trust those over this
> README for engineering decisions.

Built for teams who refuse to pay $20–$40/month per developer for black-box AI tools.

```bash
# One command. Your entire AI team ready.
$ ancient init
$ ancient team use elite-squad
$ ancient "Build a React dashboard with real-time WebSocket charts"

🤖 Coordinator (gpt-4o)    → Planning task decomposition...
🤖 Architect (claude-sonnet) → Designing system structure...
🤖 Coder A (claude-sonnet)   → Writing implementation...
🤖 Coder B (gpt-4o)          → Writing alternative implementation...
🤖 Judge (gpt-4o)            → Evaluating solutions...
✅ Best solution selected. Files written. Tests passing.
```

---

## ✨ What Makes ANCIENT Different?

| Feature | Claude Code | Cursor | Copilot | **ANCIENT** |
|---------|-------------|--------|---------|-------------|
| **Self-Hosted** | ❌ | ❌ | ❌ | ✅ **Full control** |
| **Per-Seat Cost** | $20/mo | $20/mo | $19/mo | ✅ **Free / BYOK** |
| **Multi-Agent Teams** | ❌ | ❌ | ❌ | ✅ **Design your squad** |
| **Per-Agent Model Routing** | ❌ | ❌ | ❌ | ✅ **gpt-4o + Claude + Local** |
| **Coordination Protocols** | ❌ | ❌ | ❌ | ✅ **6 patterns** |
| **Terminal-Native** | ✅ | ❌ | ❌ | ✅ **Ink + React** |
| **Model Fallback Chains** | ❌ | ❌ | ❌ | ✅ **Auto-recovery** |
| **Checkpoint & Rewind** | ✅ | ❌ | ❌ | ✅ **Git-backed** |
| **MCP Support** | ✅ | ❌ | ❌ | ✅ **Extensible** |
| **Proprietary License** | N/A | N/A | N/A | ✅ **Commercial ready** |

---

## 🧠 The Sub-Agent System

ANCIENT 3.0 introduces a **multi-agent orchestration framework** built into an AI coding assistant. Design teams, assign roles, pick models, and watch them collaborate.

> See `docs/ARCHITECTURE.md` §2 for what of this is actually wired today (and §5 for the
> "complexity must be earned" strategy ladder that governs whether a team protocol is used for a
> given task).

### 6 Coordination Protocols

```mermaid
flowchart TB
    subgraph HIERARCHICAL["🏢 HIERARCHICAL"]
        direction TB
        H1[👑 Coordinator<br/>gpt-4o] --> H2[🏗️ Architect<br/>Claude]
        H1 --> H3[💻 Coder<br/>Claude]
        H1 --> H4[🔍 Reviewer<br/>GPT-4o-mini]
    end

    subgraph PIPELINE["🔄 PIPELINE"]
        direction LR
        P1[Plan] --> P2[Design] --> P3[Code] --> P4[Review] --> P5[Test]
    end

    subgraph SWARM["🐝 SWARM"]
        direction TB
        S1[Coder A] --> Judge
        S2[Coder B] --> Judge
        S3[Coder C] --> Judge
        Judge[⚖️ Judge] --> Result[✅ Best Solution]
    end

    subgraph CONSENSUS["🗳️ CONSENSUS"]
        direction TB
        C1[Reviewer 1] --> Vote
        C2[Reviewer 2] --> Vote
        C3[Reviewer 3] --> Vote
        C4[Reviewer 4] --> Vote
        C5[Reviewer 5] --> Vote
        Vote{Majority<br/>Threshold} --> Approved[✅ Approved]
    end

    subgraph DEBATE["⚔️ DEBATE"]
        direction TB
        D1[Architect A] <--> Moderator
        D2[Architect B] <--> Moderator
        Moderator[🎯 Moderator] --> Synthesis[📄 Synthesis]
    end

    subgraph ROUNDROBIN["🔁 ROUND-ROBIN"]
        direction TB
        R1[Turn 1: Coder] --> R2[Turn 2: Reviewer] --> R3[Turn 3: Optimizer]
    end
```

### 12 Built-In Agent Roles

Every role comes with **pre-configured system prompts**, **capability flags**, **tool access**, and **preferred model lists**.

| Role | Purpose | Default Model |
|------|---------|---------------|
| 👑 **Coordinator** | Delegates, plans, synthesizes | `gpt-4o` |
| 📋 **Planner** | Breaks tasks into milestones | `claude-3.5-sonnet` |
| 🏗️ **Architect** | Designs system structure | `claude-3.5-sonnet` |
| 💻 **Coder** | Writes implementation | `claude-3.5-sonnet` |
| 🔍 **Reviewer** | Quality gate, finds bugs | `gpt-4o-mini` |
| 🧪 **Tester** | Writes tests, verifies coverage | `gpt-4o-mini` |
| 🐛 **Debugger** | Root-cause analysis | `claude-3.5-sonnet` |
| 📚 **Researcher** | Gathers docs, evaluates approaches | `gpt-4o` |
| 📝 **Documenter** | READMEs, API docs, ADRs | `claude-3.5-sonnet` |
| 🎯 **Specialist** | Domain expert (customizable) | `claude-3.5-sonnet` |
| ⚡ **Executor** | Runs shell commands safely | `gpt-4o-mini` / Free |
| ✅ **Validator** | Final approval gate | `gpt-4o` |

### Per-Agent Model Routing

Assign **different models and providers** to every agent. Fallback chains auto-recover on failure.

```typescript
const team = TeamBuilder.create("EliteSquad")
  .withCoordinator("boss", { 
    model: "gpt-4o", 
    provider: "openai",
    fallbackModels: [{ model: "claude-3.5-sonnet", provider: "anthropic" }]
  })
  .addAgent("senior-dev", { 
    role: "coder", 
    model: "claude-3.5-sonnet", 
    provider: "anthropic",
    reportsTo: "boss" 
  })
  .addAgent("cost-cutter", { 
    role: "reviewer", 
    model: "mistralai/devstral-2512:free", 
    provider: "openrouter",  // FREE TIER
    reportsTo: "boss" 
  })
  .useProtocol("hierarchical", { maxDepth: 3 })
  .build();
```

---

## 🏗 Architecture

```mermaid
flowchart TB
    subgraph Terminal["💻 TERMINAL (Ink UI)"]
        direction LR
        Chat["💬 Chat Screen"]
        Menu["📋 Command Menu"]
        Viewer["🌳 Agent Hierarchy Viewer"]
    end

    subgraph Agent["@ANCIENT/agent"]
        direction TB
        Arena["🎯 Arena<br/>Coordinator<br/>6 protocols"]
        Team["👥 Team<br/>Builder<br/>12 roles"]
        Runtime["⚙️ Runtime<br/>Executor → Scheduler<br/>StateManager → Context"]
        Tasks["📋 Tasks<br/>Decomposer<br/>Assigner<br/>Tracker"]
        Backends["🔌 Backends<br/>Router<br/>Factory<br/>Registry"]
    end

    subgraph Server["@ANCIENT/server (Hono)"]
        direction LR
        Auth["🔐 /auth<br/>OAuth/JWT"]
        ChatAPI["💬 /chat<br/>SSE Stream"]
        AgentAPI["🤖 /agent/*<br/>REST API"]
    end

    subgraph Database["@ANCIENT/database (Prisma)"]
        direction LR
        Users["👤 Users"]
        Sessions["📅 Sessions"]
        Messages["💬 Messages"]
        TeamsDB["👥 Teams"]
        AgentsDB["🤖 Agents"]
        Executions["⚡ Executions"]
        Checkpoints["📸 Checkpoints"]
        Providers["🔑 ProviderConnections"]
    end

    Terminal --> Agent
    Agent --> Server
    Server --> Database

    style Terminal fill:#1a1a2e,stroke:#8A2BE2,color:#fff
    style Agent fill:#0f3460,stroke:#7FC4BE,color:#fff
    style Server fill:#16213e,stroke:#ff6b6b,color:#fff
    style Database fill:#0a1931,stroke:#f9f1a5,color:#fff
```

### Monorepo Structure

```mermaid
graph TD
    Root["ancient/"] --> Packages["packages/"]
    Root --> DockerCompose["docker-compose.yml"]
    Root --> EnvExample[".env.example"]
    Root --> License["LICENSE"]

    Packages --> CLI["cli/<br/>Terminal UI<br/>React + Ink"]
    Packages --> Agent["agent/<br/>Multi-agent system"]
    Packages --> Server["server/<br/>Hono HTTP API"]
    Packages --> Database["database/<br/>Prisma + PostgreSQL"]
    Packages --> Shared["shared/<br/>Zod schemas + types"]

    Agent --> Arena["src/arena/<br/>6 coordination protocols"]
    Agent --> Team["src/team/<br/>12 roles + templates"]
    Agent --> Tasks["src/tasks/<br/>Decomposer, assigner, tracker"]
    Agent --> Runtime["src/runtime/<br/>Execution engine"]
    Agent --> Backends["src/backends/<br/>Model router"]

    style Root fill:#8A2BE2,stroke:#fff,color:#fff
    style Packages fill:#7FC4BE,stroke:#fff,color:#000
    style Agent fill:#ff6b6b,stroke:#fff,color:#fff
```

---

## ⚡ Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.1+
- [Docker](https://docker.com) (for PostgreSQL)
- API keys for at least one provider (OpenAI, Anthropic, OpenRouter, or local Ollama)

### 1. Clone & Install

```bash
git clone https://github.com/D-engahmed/ancient.git
cd ancient
bun install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys
```

```env
DATABASE_URL="postgresql://ancient:ancient@localhost:5432/ancient?schema=public"
JWT_SECRET="your-super-secret-jwt-key"
ENCRYPTION_KEY="your-32-byte-encryption-key"
OPENROUTER_API_KEY="sk-or-v1-..."  # Optional — supports BYOK per user
```

### 3. Start Infrastructure

```bash
docker-compose up -d  # PostgreSQL
bun run db:migrate    # Run Prisma migrations
bun run db:seed       # Seed default data
```

### 4. Run in Terminal Mode (Claude Code Style)

```bash
bun run dev:cli       # Terminal UI with local agent execution
```

### 5. Or Start the Full Stack

```bash
bun run dev:server    # API server
bun run dev:cli       # Terminal UI (in another terminal)
```

---

## 🎮 Usage

### Terminal Commands

```bash
# Start a new session with default team
$ ancient

# Use a built-in template
$ ancient team use swarm-coding
$ ancient "Implement a red-black tree in TypeScript"

# Create custom team interactively
$ ancient team new
? Team name: MySquad
? Protocol: hierarchical / pipeline / swarm / consensus / debate / round-robin
? Add agent: coder (claude-3.5-sonnet)
? Add agent: reviewer (gpt-4o-mini)
✅ Team "MySquad" created with 3 agents

# View agent hierarchy
$ ancient agents
📊 MySquad (hierarchical)
├── 🤖 boss (coordinator) — gpt-4o
├── 🧑‍💻 coder (coder) — claude-3.5-sonnet
└── 🔍 reviewer (reviewer) — gpt-4o-mini

# Execute with specific team
$ ancient --team MySquad "Refactor auth module to use JWT"
```

### Programmatic API

```typescript
import { ExecutionEngine, TeamBuilder } from "@ANCIENT/agent";

const engine = new ExecutionEngine();

const team = TeamBuilder.create("DebugSquad")
  .withCoordinator("commander", { model: "gpt-4o", provider: "openai" })
  .addAgent("debugger", { role: "debugger", model: "claude-3.5-sonnet", provider: "anthropic", reportsTo: "commander" })
  .addAgent("tester", { role: "tester", model: "gpt-4o-mini", provider: "openai", reportsTo: "commander" })
  .useProtocol("hierarchical")
  .build();

const result = await engine.execute(team, "Fix the memory leak in the WebSocket handler");
console.log(result.output);
```

---

## 🔧 Configuration

### Agent Teams (`~/.ancient/teams/`)

Teams are stored as JSON files in your home directory for instant loading:

```json
{
  "id": "elite-squad",
  "name": "Elite Squad",
  "protocol": { "type": "hierarchical", "maxDepth": 3 },
  "agents": [
    {
      "name": "boss",
      "role": "coordinator",
      "backend": { "provider": "openai", "model": "gpt-4o" }
    }
  ]
}
```

### Provider Connections

ANCIENT supports **Bring-Your-Own-Key** (BYOK) per user. Each team member can use their own API keys, encrypted at rest with AES-256-GCM.

| Provider | Models Supported |
|----------|-----------------|
| **OpenAI** | GPT-4o, GPT-4o-mini, o1 |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Opus |
| **OpenRouter** | 100+ models, including free tiers |
| **Google** | Gemini Pro |
| **Ollama** | Local models — Llama 3, Mistral, CodeLlama |
| **Local** | Any OpenAI-compatible endpoint |

---

## 🛡 Safety & Guardrails

ANCIENT is built for production teams:

- 🔒 **Encrypted API Keys** — AES-256-GCM at rest
- 🛡 **Filesystem Sandboxing** — Agents cannot escape the project directory
- ⚠️ **Dangerous Command Blocklist** — `rm -rf /`, `mkfs`, `dd` require explicit approval
- 📋 **Checkpoint System** — Shadow-git snapshots before every BUILD turn. `/rewind` restores files + history
- 🧠 **Smart Model Routing** — Free models for simple queries, premium models for complex reasoning
- 📊 **Cost Tracking** — Per-execution cost breakdown across all agents

---

## 📈 Roadmap

```mermaid
gantt
    title ANCIENT Development Roadmap
    dateFormat  YYYY-MM
    section Completed
    v1.0 Terminal UI           :done, 2024-01, 2024-06
    v2.0 Skills & MCP          :done, 2024-07, 2025-03
    v3.0 Multi-agent System    :done, 2025-04, 2026-08
    section In Progress
    v3.1 VS Code Extension     :active, 2026-08, 2026-12
    v3.2 Web Dashboard         :active, 2026-09, 2027-02
    section Planned
    v4.0 Self-improving Agents :2027-03, 2027-09
    v4.0 Agent Marketplace     :2027-06, 2027-12
```

| Phase | Feature | Status |
|-------|---------|--------|
| ✅ v1.0 | Terminal UI + basic chat | Released |
| ✅ v2.0 | Skills, subagents, MCP, checkpoints | Released |
| ✅ v3.0 | **Multi-agent system** (Arena, Team, Tasks, Runtime, Backends) | **Current** |
| 🔄 v3.1 | VS Code Extension | In Progress |
| 🔄 v3.2 | Web Dashboard for team management | In Progress |
| 📋 v4.0 | Self-improving agents (meta-learning) | Planned |
| 📋 v4.0 | Agent marketplace (shareable team templates) | Planned |

---

## 🤝 Contributing

ANCIENT is **proprietary software** (not open source). We welcome:

- 🐛 **Bug reports** via GitHub Issues
- 💡 **Feature requests** via GitHub Discussions
- 🏢 **Enterprise partnerships** — contact us for custom deployments

For commercial licensing, multi-tenant SaaS deployment, or white-label solutions, please reach out.

---

## 📄 License

**Proprietary License** — All rights reserved.

This software is provided under a commercial license. See [LICENSE](LICENSE) for full terms.

| Permission | Status |
|------------|--------|
| ✅ **Self-host** for your organization | Allowed |
| ✅ **Modify** for internal use | Allowed |
| ❌ **Redistribute** without authorization | Prohibited |
| ❌ **Use** in competing products | Prohibited |

For licensing inquiries: [Contact Us](mailto:contact@ancient.dev)

---

<div align="center">

**Built with 💜 by the ANCIENT Team**

[⭐ Star us on GitHub](https://github.com/D-engahmed/ancient) · [🐛 Report Bug](https://github.com/D-engahmed/ancient/issues) · [💡 Request Feature](https://github.com/D-engahmed/ancient/discussions)

</div>
