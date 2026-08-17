# Business Plan — Open-Core + SaaS

Two versions, one codebase: **ANCIENT OSS** (free, self-hosted, fully
functional forever) and **ANCIENT Cloud** (paid SaaS layer on top). This is
the model that built GitLab, Sentry, Posthog, and Supabase — and it's the
natural fit for a dev tool whose users inspect what runs on their machine.

## 1. Why open-core fits this product

- AI coding CLIs live or die on **trust and hackability** — developers read
  the source of tools that touch their code. Open source is the marketing.
- The OSS agent is **BYOK**: users pay model providers directly, so the free
  tier has **near-zero marginal cost** to you. No free-tier burn rate.
- The features people *pay* for are the ones that require running
  infrastructure: sync, teams, policies, dashboards — not the agent loop.

## 2. Version split

| | ANCIENT OSS (free) | ANCIENT Cloud (paid) |
|---|---|---|
| Agent loop, all modes, tools | ✅ | ✅ |
| Skills / subagents / hooks / MCP / memory | ✅ local | ✅ + team-shared libraries |
| Checkpoints, compaction, model routing | ✅ local | ✅ + cross-device |
| Providers | BYOK + free/local | BYOK **or** managed credits |
| Session sync across devices | — | ✅ |
| Team workspaces (shared skills/agents/memory) | — | ✅ |
| Org model policies ("devs use free-first routing") | — | ✅ |
| Usage/cost dashboards | — | ✅ |
| Audit log, SSO/SAML | — | Enterprise tier |
| Support | community | SLA tiers |

**Hard rule:** anything in OSS today never moves behind the paywall. Cloud
only adds things that need servers.

## 3. Pricing sketch

| Tier | Price | Target |
|---|---|---|
| OSS | $0 | individuals, offline shops |
| Cloud Pro | ~$12/user/mo | solo devs wanting sync + managed credits |
| Cloud Team | ~$25/user/mo | teams sharing skills/agents/policies |
| Enterprise | custom | SSO, audit, self-hosted control plane |

Managed model credits (reselling API access with pooled pricing) is the
natural expansion revenue — users who don't want to manage five provider keys.

## 4. Moat & differentiation

Claude Code is single-vendor and subscription-gated; ANCIENT's wedge:

1. **Any model, including free/local** — free-first routing is a feature
   incumbents selling their own models can't copy honestly.
2. **The extension ecosystem is files** — skills/agents/commands/hooks are
   markdown + JSON users already version in git. A marketplace (Phase 4) with
   revenue share (80/20) turns that into network effects.
3. **Self-hostable control plane** for enterprises with compliance needs.

## 5. Execution order

1. **Now → Phase 3** (`docs/ROADMAP.md`): depth features, dogfood, grow OSS stars/users.
2. **Phase 4**: headless/CI mode + plugin marketplace — the distribution engine.
3. **Phase 5**: managed sync MVP (accounts + session sync) behind a `cloud` feature flag in the same monorepo. Only build Team features after sync has paying users.

## 6. Licensing

- OSS packages: **Apache-2.0 or MIT** (max adoption; the SaaS is the moat, not the license).
- If marketplace cloning worries you later, relicense *new* cloud-only packages under a source-available license (BUSL) — the OSS core stays permissive.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Big vendor ships similar routing | Move faster on ecosystem/marketplace; routing is a feature, network effects are the moat |
| OSS users never convert | Normal — 1–3% conversion is healthy when free tier costs ~$0 |
| Marketplace spam/quality | Curated "verified" tier + install counts + reviews from day one |
