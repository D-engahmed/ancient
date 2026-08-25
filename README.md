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

ANCIENT 3.0 introduces the **most powerful multi-agent orchestration framework** ever built into an AI coding assistant. Design teams, assign roles, pick models, and watch them collaborate.

### 6 Coordination Protocols

```
┌─────────────────────────────────────────────────────────────────┐
│  HIERARCHICAL        COORDINATOR delegates to specialists        │
│  ├── Coordinator (gpt-4o)                                       │
│  ├── Architect (Claude)                                         │
│  ├── Coder (Claude)                                             │
│  └── Reviewer (GPT-4o-mini)                                     │
├─────────────────────────────────────────────────────────────────┤
│  PIPELINE            Assembly line — each agent improves output   │
│  Plan → Design → Code → Review → Test                           │
├─────────────────────────────────────────────────────────────────┤
│  SWARM               N agents solve in parallel, judge picks best │
│  Coder A + Coder B + Coder C → Judge evaluates                  │
├─────────────────────────────────────────────────────────────────┤
│  CONSENSUS           Agents vote, majority wins                 │
│  5 reviewers vote → threshold 3 → result approved               │
├─────────────────────────────────────────────────────────────────┤
│  DEBATE              Adversarial argumentation                   │
│  Architect A vs Architect B → Moderator synthesizes             │
├─────────────────────────────────────────────────────────────────┤
│  ROUND-ROBIN         Agents take turns improving artifact        │
│  Turn 1: Coder → Turn 2: Reviewer → Turn 3: Optimizer           │
└─────────────────────────────────────────────────────────────────┘
```

### 12 Built-In Agent Roles

Every role comes with **pre-configured system prompts**, **capability flags**, **tool access**, and **preferred model lists**.

| Role | Purpose | Default Model |
|------|---------|---------------|
| **Coordinator** | Delegates, plans, synthesizes | `gpt-4o` |
| **Planner** | Breaks tasks into milestones | `claude-3.5-sonnet` |
| **Architect** | Designs system structure | `claude-3.5-sonnet` |
| **Coder** | Writes implementation | `claude-3.5-sonnet` |
| **Reviewer** | Quality gate, finds bugs | `gpt-4o-mini` |
| **Tester** | Writes tests, verifies coverage | `gpt-4o-mini` |
| **Debugger** | Root-cause analysis | `claude-3.5-sonnet` |
| **Researcher** | Gathers docs, evaluates approaches | `gpt-4o` |
| **Documenter** | READMEs, API docs, ADRs | `claude-3.5-sonnet` |
| **Specialist** | Domain expert (customizable) | `claude-3.5-sonnet` |
| **Executor** | Runs shell commands safely | `gpt-4o-mini` / Free |
| **Validator** | Final approval gate | `gpt-4o` |

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

```
┌─────────────────────────────────────────────────────────────────────┐
│                         TERMINAL (Ink UI)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │  Chat Screen │  │ Command Menu │  │  Agent Hierarchy Viewer  │ │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘ │
└────────────────────────┬────────────────────────────────────────────┘
                         │  imports
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      @ANCIENT/agent                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐│
│  │   Arena     │  │    Team     │  │          Runtime            ││
│  │ Coordinator │  │   Builder   │  │  Executor → Scheduler →     ││
│  │  (6 proto-  │  │  (12 roles) │  │  StateManager → Context     ││
│  │   cols)     │  │  Templates  │  │                             ││
│  └─────────────┘  └─────────────┘  └─────────────────────────────┘│
│  ┌─────────────┐  ┌─────────────┐                                  │
│  │    Tasks    │  │   Backends  │  • Model Router                 │
│  │ Decomposer  │  │   Router    │  • Fallback Chains              │
│  │  Assigner   │  │   Factory   │  • Cost Tracking                │
│  │   Tracker   │  │  Registry   │  • Latency Optimization         │
│  └─────────────┘  └─────────────┘                                  │
└────────────────────────┬────────────────────────────────────────────┘
                         │  imports
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      @ANCIENT/server (Hono)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │  /auth       │  │  /chat       │  │  /agent/* (REST API)     │ │
│  │  OAuth/JWT   │  │  SSE Stream  │  │  Teams · Execute ·       │ │
│  └──────────────┘  └──────────────┘  │  Templates · Status      │ │
│                                        └──────────────────────────┘ │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      @ANCIENT/database (Prisma)                     │
│  Users · Sessions · Messages · Teams · Agents · Executions ·        │
│  Checkpoints · ProviderConnections                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Monorepo Structure

```
ancient/
├── packages/
│   ├── cli/              # Terminal UI (React + Ink)
│   ├── agent/            # 🆕 Multi-agent orchestration system
│   │   ├── src/arena/    # 6 coordination protocols
│   │   ├── src/team/     # Team builder + 12 roles + templates
│   │   ├── src/tasks/    # Decomposer, assigner, tracker
│   │   ├── src/runtime/  # Execution engine + state manager
│   │   └── src/backends/ # Model router + fallback chains
│   ├── server/           # Hono HTTP API
│   ├── database/         # Prisma ORM + PostgreSQL
│   └── shared/           # Zod schemas + types (cross-package)
├── docker-compose.yml    # Postgres + App
├── .env.example          # Configuration template
└── LICENSE               # Proprietary (Commercial)
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

Supported providers:
- **OpenAI** (GPT-4o, GPT-4o-mini, o1)
- **Anthropic** (Claude 3.5 Sonnet, Claude 3 Opus)
- **OpenRouter** (100+ models, including free tiers)
- **Google** (Gemini Pro)
- **Ollama** (local models — Llama 3, Mistral, CodeLlama)
- **Local** (any OpenAI-compatible endpoint)

---

## 🛡 Safety & Guardrails

ANCIENT is built for production teams:

- **🔒 Encrypted API Keys** — AES-256-GCM at rest
- **🛡 Filesystem Sandboxing** — Agents cannot escape the project directory
- **⚠ Dangerous Command Blocklist** — `rm -rf /`, `mkfs`, `dd` require explicit approval
- **📋 Checkpoint System** — Shadow-git snapshots before every BUILD turn. `/rewind` restores files + history
- **🧠 Smart Model Routing** — Free models for simple queries, premium models for complex reasoning
- **📊 Cost Tracking** — Per-execution cost breakdown across all agents

---

## 📈 Roadmap

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

- **Bug reports** via GitHub Issues
- **Feature requests** via GitHub Discussions
- **Enterprise partnerships** — contact us for custom deployments

For commercial licensing, multi-tenant SaaS deployment, or white-label solutions, please reach out.

---

## 📄 License

**Proprietary License** — All rights reserved.

This software is provided under a commercial license. See [LICENSE](LICENSE) for full terms.

- ✅ **Self-host** for your organization
- ✅ **Modify** for internal use
- ❌ **Redistribute** without authorization
- ❌ **Use** in competing products

For licensing inquiries: [Contact Us](mailto:contact@ancient.dev)

---

<div align="center">

**Built with 💜 by the ANCIENT Team**

[⭐ Star us on GitHub](https://github.com/D-engahmed/ancient) · [🐛 Report Bug](https://github.com/D-engahmed/ancient/issues) · [💡 Request Feature](https://github.com/D-engahmed/ancient/discussions)

</div>
