# Checkpoints & Rewind

Every BUILD-mode turn starts by snapshotting your workspace. If the agent
goes sideways — bad refactor, wrong file deleted — `/rewind` restores both
the **files** and the **conversation** to any earlier checkpoint.

## How it works: shadow git

ANCIENT keeps a hidden git repository per workspace:

```
GIT_DIR  = ~/.ancient/checkpoints/<hash-of-cwd>/repo
WORK_TREE= your project directory
```

Your project never gets a `.git` it didn't ask for; a project that *is* a git
repo is completely unaffected (`.git` itself is excluded from snapshots).

- A checkpoint is created **before each BUILD turn** — but only when
  something actually changed (no noise checkpoints).
- Up to **100 checkpoints** per workspace are retained.
- Disable per workspace: `"checkpoints": { "enabled": false }` in settings.

## Rewinding

Palette → `/rewind` → pick a checkpoint (label = the prompt that triggered it).

Two things happen:

1. **Files**: tracked content restored to the snapshot; files created after
   the checkpoint are deleted.
2. **Conversation**: messages after the checkpoint are removed from the
   session. Reopen the session to see the trimmed history.

```
API:
GET  /extensions/checkpoints/:sessionId
POST /extensions/rewind/:sessionId   { "checkpointId": "a1b2c3d" }
```

## Limits & notes

- Requires `git` on the server. Without it, checkpointing silently disables
  itself (logged once).
- Very large/binary-heavy workspaces: snapshots copy what git copies. Giant
  generated folders should be git-ignored in your project (the shadow repo
  respects `.gitignore`).
- Checkpoints are **local disaster recovery**, not a substitute for real
  commits. `/commit` exists for that.
