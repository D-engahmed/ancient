# Hooks

Hooks are your shell commands that run around agent lifecycle events —
guardrails, linters, and context injectors you control. Configured in
`.ancient/settings.json` (project) merged over `~/.ancient/settings.json` (user).

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "bash", "command": "./scripts/guard.sh" }
    ],
    "PostToolUse": [
      { "matcher": "editFile", "command": "bun run lint --staged" }
    ],
    "SessionStart": [
      { "command": "echo '{\"additionalContext\": \"Release freeze until Friday.\"}'" }
    ]
  }
}
```

## Events

| Event | Fires | Payload (stdin JSON) | What the hook can do |
|---|---|---|---|
| `SessionStart` | First message of a session | `session_id`, `cwd` | Inject context into the system prompt |
| `UserPromptSubmit` | Every user message | + `prompt` | Inject context for that turn |
| `PreToolUse` | Before any tool executes | + `tool_name`, `tool_input` | **Block** the call |
| `PostToolUse` | After a tool executes | + `tool_output` | Append context to the result |

## Protocol

The hook receives JSON on **stdin** and answers on **stdout**:

```jsonc
// Block a tool call (PreToolUse only):
{"decision": "block", "reason": "git push requires manual approval"}

// Inject context (any event):
{"additionalContext": "tests are flaky in CI today"}

// Plain non-JSON stdout is treated as additionalContext — handy for
// simple hooks: echo "remember to run migrations"
```

## Matchers

`matcher` applies to `PreToolUse`/`PostToolUse` and matches tool names:

- `"bash"` — exact
- `"mcp__*"` — trailing wildcard (every MCP tool)
- `"*"` or omitted — all tools

## Guarantees & limits

- Hooks are **best-effort**: a failing, missing, or slow hook never crashes a
  turn. Default timeout 10 s (`timeoutMs` per hook).
- Hooks run **on the server**, in the workspace directory — a malicious prompt
  can't bypass them by tricking the client.
- PreToolUse block reasons are returned to the model as a tool error, so the
  agent can route around the block.
- Stdout is capped at 64 KB; payloads truncate tool output at 8 KB.
- Hooks receive `ANCIENT_HOOK=1` in the environment.

## Example: block force-pushes

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "command": "sh -c 'grep -q \"push.*--force\" <<< \"$(cat)\" && echo \"{\\\"decision\\\":\\\"block\\\",\\\"reason\\\":\\\"no force pushes\\\"}\" || true'"
      }
    ]
  }
}
```

See `examples/settings.example.json` for a full working file.
