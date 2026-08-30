# Layer 21 --- Implementation Guide

## Purpose

The previous 20 documents describe *what* the system is and *how it
must fail safely*. This document is the concrete build plan: repo
layout, tech choices, schemas, code skeletons, and a week-by-week
sequence that respects the dependency order in Layer 09 (Migration
Plan) and never builds a happy path without its failure path attached
(Layer 20).

------------------------------------------------------------------------

## 1. Suggested tech stack

``` text
Language:        TypeScript everywhere (engine, gateway, capabilities)
                  --- one language across the core keeps the contracts
                  (ErrorEnvelope, Capability, ModelProviderPlugin)
                  literally the same types on both sides of every call.

Runtime:          Node.js (LTS) for the engine + gateway.
                  A capability may shell out to any language it needs
                  (Python for data tools, etc.) but it is wrapped
                  behind the TypeScript Capability contract.

Execution store:  PostgreSQL (durable relational state, Layer 6.3)
Event log:        PostgreSQL append-only table to start (Layer 6.4);
                  graduate to Kafka/NATS JetStream only when volume or
                  multi-consumer fan-out actually requires it
                  (Principle 4: complexity must be earned).
Cache:            Redis (ephemeral acceleration + circuit breaker state)
Object storage:   S3-compatible (artifacts, large outputs)
Queue:            Redis-backed queue (BullMQ) or Postgres-backed queue
                  (pg-boss) to start; both satisfy backpressure (12.8)
                  without adding a new infra dependency on day one.
Observability:    OpenTelemetry traces + a metrics backend (Prometheus/
                  Grafana or a hosted equivalent) from the first week,
                  not bolted on later (Layer 7, Layer 09 Phase 6).
Gateway framework: Fastify or Hono (thin, does not tempt you to put
                  orchestration logic in route handlers --- Layer 2's
                  anti-pattern).
```

None of these choices are load-bearing for the architecture itself ---
every one of them sits behind a contract (`IExecutionStore`,
`IEventLog`, `ModelProviderPlugin`) and can be swapped later per
Principle 5 (dependency inversion). Pick these to move fast now.

------------------------------------------------------------------------

## 2. Repository layout

``` text
ancient/
├── packages/
│   ├── contracts/            # ErrorEnvelope, ErrorCode, Execution, Capability,
│   │                          # ModelProviderPlugin, Checkpoint types. Zero deps.
│   ├── reliability/           # retry, circuit breaker, backoff, backpressure,
│   │                          # checkpoint/recovery primitives. Depends only on contracts.
│   ├── model-runtime/         # Provider Registry, Model Policy, provider plugins
│   │   └── providers/
│   │       ├── anthropic/
│   │       ├── openai/
│   │       ├── deepseek/
│   │       ├── openai-compatible-local/   # ollama / vLLM / LM Studio
│   │       └── byok/                       # user-supplied key wrapper
│   ├── capabilities/
│   │   ├── tools/            # read_file, write_file, run_command, search...
│   │   ├── skills/
│   │   ├── mcp/
│   │   └── design-tools/
│   ├── strategies/
│   │   ├── direct/
│   │   ├── agent-loop/
│   │   ├── subagents/
│   │   ├── team/
│   │   └── arena/
│   ├── execution/             # lifecycle manager, orchestrator, context manager
│   ├── infrastructure/
│   │   ├── postgres-store/
│   │   ├── event-log/
│   │   ├── object-store/
│   │   └── secrets/
│   ├── gateway/                # HTTP/WS/SSE boundary, auth, error mapper
│   └── shared/                 # generic utilities only
├── apps/
│   ├── api-server/             # boots gateway + execution against infra
│   ├── coding-experience/
│   ├── design-experience/
│   └── cowork-experience/
├── infra/
│   ├── docker-compose.yml      # local Postgres, Redis, MinIO (S3-compatible)
│   └── migrations/
└── docs/                        # <- this document set, kept in the repo, versioned with code
```

------------------------------------------------------------------------

## 3. Core database schema (PostgreSQL)

``` sql
create table executions (
  id                uuid primary key,
  status            text not null check (status in
                       ('created','queued','running','waiting_approval',
                        'paused','checkpointed','completed','failed','cancelled')),
  request           jsonb not null,
  context_ref       text,
  strategy          jsonb,
  retry_count       int not null default 0,
  last_error        jsonb,              -- ErrorEnvelope, nullable
  checkpoint_ref    text,
  tenant_id         uuid not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_executions_tenant_status on executions (tenant_id, status);

create table execution_events (
  id                bigserial primary key,
  execution_id      uuid not null references executions(id),
  sequence          bigint not null,         -- monotonic per execution (Layer 6.4)
  event_type        text not null,
  payload           jsonb not null,
  occurred_at       timestamptz not null default now(),
  unique (execution_id, sequence)
);

create table checkpoints (
  id                uuid primary key,
  execution_id      uuid not null references executions(id),
  sequence          bigint not null,
  state_snapshot    jsonb not null,
  created_before    text,                    -- capabilityId, if pre-risky-action
  created_at        timestamptz not null default now()
);

create table idempotency_keys (
  key               text primary key,        -- hash(execution_id, step_id)
  execution_id      uuid not null,
  result            jsonb,                   -- cached result for safe replay
  created_at        timestamptz not null default now()
);

create table effect_records (
  id                uuid primary key,
  execution_id      uuid not null,
  capability_id     text not null,
  input             jsonb not null,
  verified_state    jsonb,
  occurred_at       timestamptz not null default now()
);
```

`execution_events` and `idempotency_keys` together are what make Layer
12's recovery and idempotency guarantees real rather than aspirational
--- every retry checks `idempotency_keys` before re-executing anything.

------------------------------------------------------------------------

## 4. Core contract code (drop-in starting point)

``` ts
// packages/contracts/src/error.ts
export type ErrorDomain =
  | 'edge' | 'auth' | 'gateway' | 'engine' | 'strategy'
  | 'capability' | 'provider' | 'infrastructure' | 'policy'

export interface ErrorEnvelope {
  code: string
  domain: ErrorDomain
  message: string
  clientMessage?: string
  transient: boolean
  retryableAsIs: boolean
  partialEffect: 'none' | 'unknown' | 'occurred'
  blastRadius: 'step' | 'strategy' | 'execution' | 'tenant' | 'platform'
  executionId?: string
  stepId?: string
  capabilityId?: string
  providerId?: string
  traceId: string
  occurredAt: string
  attempt: number
  cause?: ErrorEnvelope
  raw?: unknown
}

export function makeError(partial: Omit<ErrorEnvelope, 'occurredAt' | 'attempt'> & { attempt?: number }): ErrorEnvelope {
  return { attempt: 1, ...partial, occurredAt: new Date().toISOString() }
}
```

``` ts
// packages/reliability/src/retry.ts
import { ErrorEnvelope } from '@ancient/contracts'

export interface RetryBudget {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  jitter: boolean
  backoffMultiplier: number
}

export function nextDelay(attempt: number, budget: RetryBudget): number {
  const raw = Math.min(budget.maxDelayMs, budget.baseDelayMs * Math.pow(budget.backoffMultiplier, attempt))
  return budget.jitter ? raw * (0.5 + Math.random() * 0.5) : raw
}

export async function withRetry<T>(
  op: (attempt: number) => Promise<T>,
  budget: RetryBudget,
  shouldRetry: (err: ErrorEnvelope) => boolean
): Promise<T> {
  let lastErr: ErrorEnvelope | undefined
  for (let attempt = 1; attempt <= budget.maxAttempts; attempt++) {
    try {
      return await op(attempt)
    } catch (e) {
      lastErr = e as ErrorEnvelope
      if (!shouldRetry(lastErr) || attempt === budget.maxAttempts) throw lastErr
      await new Promise((r) => setTimeout(r, nextDelay(attempt, budget)))
    }
  }
  throw lastErr
}
```

``` ts
// packages/reliability/src/circuit-breaker.ts
export interface CircuitBreakerConfig {
  failureThreshold: number
  windowMs: number
  openDurationMs: number
  halfOpenTrialRequests: number
}

type State = 'closed' | 'open' | 'half_open'

export class CircuitBreaker {
  private state: State = 'closed'
  private failures: number[] = []            // timestamps
  private openedAt = 0
  private trialsUsed = 0

  constructor(private cfg: CircuitBreakerConfig) {}

  canProceed(): boolean {
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.cfg.openDurationMs) {
        this.state = 'half_open'
        this.trialsUsed = 0
        return true
      }
      return false
    }
    // half_open
    if (this.trialsUsed < this.cfg.halfOpenTrialRequests) {
      this.trialsUsed++
      return true
    }
    return false
  }

  onSuccess(): void {
    if (this.state === 'half_open') this.state = 'closed'
    this.failures = []
  }

  onFailure(): void {
    const now = Date.now()
    this.failures = this.failures.filter((t) => now - t < this.cfg.windowMs)
    this.failures.push(now)
    if (this.state === 'half_open' || this.failures.length >= this.cfg.failureThreshold) {
      this.state = 'open'
      this.openedAt = now
    }
  }
}
```

``` ts
// packages/model-runtime/src/provider-plugin.ts
export interface ModelProviderPlugin {
  id: string
  capabilities: string[]
  auth: 'api-key' | 'oauth' | 'local' | 'none'
  listModels(): Promise<ModelDescriptor[]>
  complete(req: CompletionRequest): AsyncIterable<CompletionEvent>
  healthCheck(): Promise<{ healthy: boolean; latencyMs?: number }>
}

export interface ModelDescriptor {
  providerId: string
  modelId: string
  contextWindow: number
  capabilities: string[]
  pricing?: { input: number; output: number }
}
```

These four files, plus the schema in Section 3, are enough to start
Migration Phase 1--2 (Layer 09) for real.

------------------------------------------------------------------------

## 5. Local development environment

``` yaml
# infra/docker-compose.yml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: ancient
      POSTGRES_DB: ancient
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]

  redis:
    image: redis:7
    ports: ["6379:6379"]

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ancient
      MINIO_ROOT_PASSWORD: ancient123
    ports: ["9000:9000", "9001:9001"]

volumes:
  pgdata:
```

``` text
Bring up local infra:  docker compose -f infra/docker-compose.yml up -d
Run migrations:        pnpm --filter infrastructure migrate:up
Start API server:      pnpm --filter api-server dev
```

------------------------------------------------------------------------

## 6. Build sequence (maps to Layer 09 phases, with concrete deliverables)

  Week   Phase (Layer 09)          Concrete deliverable
  ------ -------------------------- ---------------------------------------------------------------
  1      Phase 0 --- Freeze          Inventory current error sites; write ADR-009 (canonical error envelope)
  1--2   Phase 1 --- Contracts       `packages/contracts` published; `ErrorEnvelope`, `Execution`, `Capability` typed and reviewed
  2--3   Phase 2 --- Execution core  `packages/execution` with lifecycle manager + orchestrator; Postgres-backed `executions` table live
  3      Phase 3 --- Strategies      `direct` + `agent-loop` implemented behind the shared `Strategy` interface with `StrategyFailurePolicy`
  4      Phase 4 --- Capabilities    First 5 tools migrated with `idempotent`/`reversible`/`errorClass` declared; registry rejects undeclared capabilities
  4      Phase 4.5 --- Providers     `model-runtime` microkernel + first 2 provider plugins (Anthropic, one OpenAI-compatible local) + Model Policy
  5      Phase 5 --- Durable state   Checkpointing wired at strategy-step boundaries; `checkpoints` table live
  5      Phase 5.5 --- Error rollout `packages/reliability` (retry, circuit breaker) wired into `model-runtime` and `capabilities`; failure-mode table (Layer 12.11) implemented as tests
  6      Phase 6 --- Observability   OpenTelemetry traces end-to-end; dashboard showing `execution.completed` vs `execution.degraded` vs `execution.failed` by `ErrorCode`
  7+     Phase 7 --- Experiences     First real experience (Coding) wired through Gateway → Engine end-to-end, including a chaos test per Layer 16.4

**Do not start Week 7 (experiences) before Week 6's dashboard can show
a real failure-rate number.** That dashboard is the evidence Principle
4 requires before the system is allowed to grow --- without it, nobody
can tell whether the next feature made reliability better or worse.

------------------------------------------------------------------------

## 7. Definition of done for the "no breakage, no friction" goal

A feature is not done when it works. It is done when all of these are
true:

``` text
[ ] Every failure path produces an ErrorEnvelope with a Layer 20 code
[ ] Every capability declares idempotent + reversible truthfully
[ ] A chaos test exists that kills it mid-operation (Layer 16.4)
[ ] A circuit breaker or bulkhead bounds its blast radius (Layer 12.9)
[ ] Its dashboard shows up in the failure-classification metrics (Layer 7)
[ ] A user-visible failure, if any, matches the Layer 2 error-mapping
    contract (safe message + traceId, never a raw stack trace)
[ ] Switching the model/provider mid-run does not require restarting it
    (Layer 19 session portability)
```

If any box is unchecked, the feature is not "production-grade" by
Layer 00 Principle 8's own definition, regardless of how well the
happy path demos.
