# Model Routing — free-first & local models

ANCIENT can run a two-lane strategy: **simple turns go to a free or fully
local model** (OpenRouter `:free` tiers, Ollama, LM Studio, vLLM — zero cost,
optionally on-device), and **complex turns keep the premium company model**
you selected (Claude, GPT, Gemini…). This is the main cost lever — most
coding-assistant turns are small.

## Configuration

`.ancient/settings.json` (project) or `~/.ancient/settings.json` (user):

```json
{
  "modelRouting": {
    "enabled": true,
    "strategy": "free-first",
    "freeModel": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "modelId": "mistralai/devstral-2512:free",
      "apiKeyEnv": "OPENROUTER_API_KEY"
    }
  }
}
```

Or with a fully local, on-device model (no API key at all):

```json
"freeModel": { "baseUrl": "http://localhost:11434/v1", "modelId": "qwen3:14b" }
```

Environment-variable fallback (useful for servers/containers):

```
ANCIENT_FREE_MODEL_BASE_URL=http://localhost:11434/v1
ANCIENT_FREE_MODEL_ID=qwen3:14b
ANCIENT_FREE_MODEL_API_KEY=   # optional
```

## How routing decides

A transparent heuristic scores each turn:

| Signal | Score |
|---|---|
| Prompt > 800 chars | +2 |
| Prompt > 300 chars | +1 |
| Complex keywords (refactor, architect, debug, migrate, security, optimize, multi-file, deploy…) | +2 each |
| Simple keywords (rename, typo, explain, where is, quick…) | −1 each |
| PLAN mode | +1 |

**Score ≥ 3 → your selected model. Below → free lane.** Turn routing off with
`"enabled": false` or `"strategy": "premium"`.

When a turn routes free, the message metadata shows `model: "free:<id>"` and
the `routed` reason, and it's persisted on the message — you can always see
which lane produced what.

## Where else the free model is used

- **Subagents with `model: cheap`** — the built-in `explore` agent uses it, so
  bulk codebase searching costs nothing.
- **`/compact`** — summarization prefers the free model.

If no free model is configured, everything silently falls back to the
session's selected model. Nothing breaks.

## Honest limitations

- The classifier is a heuristic, not an oracle. When it guesses wrong, the
  cost is one weaker answer — ask again with more detail (longer prompt →
  higher score → premium lane), or disable routing for that project.
- Mid-stream escalation (retry a failed free call on the premium model) is on
  the Phase-3 roadmap (`docs/ROADMAP.md`); today a free-lane provider error is
  surfaced as a normal error message.
