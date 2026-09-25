# Platform Key Rotation Guide

Operational reference for the secrets an ANCIENT deployment depends on. Each
section states what the secret is, where it lives, how to rotate it, and
the blast radius of a rotation.

> **Single-deploy model (A-022).** Every secret below belongs to the
> company running the deployment, not to end users. End-user BYOK keys
> follow their own rotation cadence (Provider Connections UI).

---

## 1. Platform API key (`ANCIENT_PLATFORM_API_KEY`)

| Field              | Value                                          |
|--------------------|------------------------------------------------|
| Controls           | `/v1` public surface — models, executions, usage |
| Scope              | The whole deployment (one shared key)           |
| Env var            | `ANCIENT_PLATFORM_API_KEY`                      |
| Cipher / storage   | Plaintext in environment; never committed       |

**Rotation:**
1. Generate a new key (`openssl rand -base64 32`).
2. Update the env var (or `.env`, depending on your deployment).
3. **Restart** the server process — the key is read at import time
   (`require-api-key.ts` caches `process.env` on first hit).
4. All old CLI integrations / Coding products using the previous key
   immediately receive `401 AUTH_UNAUTHENTICATED`.

**Blast radius:** Every active `/v1` consumer loses connectivity for the
duration of the restart window. No data loss; in-flight SSE streams close
cleanly on the next `text.delta` write failure.

---

## 2. Provider env keys

| Field              | Value                                            |
|--------------------|--------------------------------------------------|
| Controls           | Platform-builtin model resolution (env-provenance) |
| Scope              | Per-provider (OpenAI, Anthropic, Google, DeepSeek, etc.) |
| Env vars           | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `DEEPSEEK_API_KEY`, … |

**Rotation:**
1. Obtain a new key from the provider console.
2. Update the env var.
3. **Hot-reload:** `process.env` is live; the next execution picks up
   the new key without a restart. No active session is disrupted —
   mid-flight requests already authenticated with the old key complete
   normally.

**Blast radius:** Zero downtime if rotated at the env-var level. Only
the provider's own key-suspension latency matters (if you revoke the
old key before issuing the new one, a narrow window of `PROVIDER_AUTH_FAILED`
errors may occur).

---

## 3. BYOK connection cipher key

| Field              | Value                                              |
|--------------------|----------------------------------------------------|
| Controls           | AES-256-GCM encryption of user BYOK provider keys at rest |
| Scope              | Every encrypted `ProviderConnection.encryptedKey` row |
| Env var            | `ANCIENT_BYOK_CIPHER_KEY` (64-hex = 32 bytes)       |
| Storage            | Environment; never committed                        |

**Rotation (requires DB migration):**
1. Generate a new key (`openssl rand -hex 32`).
2. Write a one-off migration script that:
   - Reads every `ProviderConnection.encryptedKey` row.
   - Decrypts with the old key.
   - Re-encrypts with the new key.
   - Updates in place (idempotent; script is re-runnable).
3. Update the env var and restart.

**Blast radius:** All existing BYOK connections are temporarily
undecryptable between step 1 and step 2 completion. A `PROVIDER_AUTH_FAILED`
error surfaces for affected users until the migration completes. The
migration script is short (< 30 lines) and runs in seconds for
typical key counts.

> **Do not** simply revoke the old key — `ProviderKeyCipher` reads
> `process.env.ANCIENT_BYOK_CIPHER_KEY` on construction; there is no
> fallback key ring.

---

## 4. Database (Prisma / SQLite or Postgres)

| Field              | Value                                    |
|--------------------|------------------------------------------|
| Env vars           | `DATABASE_URL` (standard Prisma format)  |
| Scope              | All persistent state: executions, BYOK connections, messages |

**Rotation:** Standard database credential rotation. Update `DATABASE_URL`,
restart. No application-level migration needed.

---

## 5. Quick-check before rotation

- Is a cost-ceiling reset needed? The current `CostLedger` is process-local,
  so a restart resets its in-memory ceiling state. Treat the deployment budget
  as operationally advisory until the ledger is backed by durable storage.
- Are any SSE streams active? They will close if the process restarts; the CLI
  reconnects with `Last-Event-ID` while the live execution bridge is available.
  **Do not claim restart-safe event replay yet:** the current wire-event buffer
  is process-local.
- Is durable lifecycle state wired? Yes — execution lifecycle events are persisted
  in PostgreSQL. A process restart can recover historical execution status, but
  transparent resume of an in-flight run is **not** implemented.
