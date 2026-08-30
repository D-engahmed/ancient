# ANCIENT — Agent conventions

Instructions for AI agents (and humans) working on this repo. Read before starting work.

---

## Repository at a glance

- **Monorepo** (Workspaces): `packages/` ← `agent`, `cli`, `server`, `shared`, `database`, and
  more. `package.json` root defines the workspace set and scripts.
- **Server:** Hono on port 3000. **CLI:** Ink terminal UI.
- **Docs:** all under `docs/`. **Config/drive:** nothing formal beyond per-package configs and
  runtime secrets in `.env` (never committed).

---

## Before you start

1. Read the top of this file **and** the relevant source, not just documentation.
2. Treat the README as *documented intent*, not *running reality*. Verify against source before
   trusting a claim. `docs/ARCHITECTURE.md` §2 records the as-built reality and §2.4 the
   honesty map (wired vs. un-wired).
3. When a claim is ambiguous, prefer to ground it in source and note the gap.

---

## Commit message convention

[Conventional Commits](https://www.conventionalcommits.org/) with repo scopes. Format:

```text
<type>(<scope>): <imperative summary>

<optional detailed body — say WHAT and WHY, list changes, note alternatives considered>
```

- **Types:** `feat` · `fix` · `refactor` · `chore` · `docs` · `test` · `perf` · `build` · `ci`.
- **Scopes seen:** `cli`, `server`, `agent`, `shared`, `database`, plus `docs`.
- Match the existing style (imperative, lowercase summary).
- Prefer smaller, well-described commits over monolithic ones. Documentation and code changes
  are separate concerns — commit them separately (`docs:` vs. code types).

### Pushing

**Always ask the user before pushing.** Never push without an explicit go-ahead in the current
session.

---

## Docs layout & Mermaid policy

- All prose docs live in `docs/`.
- `docs/ARCHITECTURE.md` — as-built audit + target architecture + strategy ladder (the narrative).
- `docs/architecture/` — deep-dive design docs. The **live assumption register** lives at
  `docs/08-assumption-register/README.md` (`ASSUMPTION-XXX` entries, fixed template). One
  markdown file per major design topic (e.g. `EXECUTION-STATE.md`).
- **Mermaid is welcome** in `docs/architecture/*` and `docs/ARCHITECTURE.md` for diagrams of
  architecture, data flow, lifecycle, and decisions. Keep diagrams honest: label `as-built`
  vs `target`, and mark any element that is currently un-wired.

### Assumption register — required for architecture work

Any architectural decision must carry an entry with the fixed shape (see
`docs/08-assumption-register/README.md`):

```text
ASSUMPTION · EVIDENCE · FAILURE MODE · BLAST RADIUS · ALTERNATIVES · DECISION · TEST
```

---

## Phase 1 — expansion freeze (ARCHITECTURE REVIEW V2)

While the architecture review is open:

- **Gate major new features.** A feature may proceed only after its assumption entry
  (assumption + decision + test) exists in the register.
- Bug fixes and small refactors are unaffected.
- Target subsystem anatomy for future work, in review order:
  1. Core product boundaries
  2. **Execution model** (most fundamental — first target)
  3. Context architecture
  4. Agent model
  5. Tool / capability architecture
  6. Provider / model architecture (BYOK, fallback, routing, cost)
  7. State & persistence
  8. Security
  9. Product experiences

---

## Verification baseline

- Typecheck: full repo typecheck must exit 0.
- Tests: the existing test suite passes (52 tests across 7 files at the 2026-08-29 baseline).
- CLI build: `npm run build` for the CLI exits 0.
- Re-run the relevant check whenever you touch a package. Docs-only changes do not require
  re-running the suite, but a quick sanity typecheck is cheap.

---

## Work flow (agents)

1. Explore/ground in source before writing or claiming.
2. Make small, single-purpose changes.
3. Verify (typecheck / tests as appropriate to the change).
4. Commit each nano-step with a detailed Conventional-Commits message.
5. Push only after asking the user.
