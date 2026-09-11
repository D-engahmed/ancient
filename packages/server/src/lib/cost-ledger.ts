// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Per-deployment cost ledger (ASSUMPTION-025, single-deploy white-label).
//
// The company that runs an ANCIENT deployment owns one spend ceiling: every
// platform-billed run (provenance "env" — the deployment's default key model)
// counts into the ledger; user BYOK runs are billed to the user's own provider
// account and never hit this ceiling. The ledger is in-memory for now — the
// durable accounting table is the infrastructure/storage layer's contract and
// wires in with the durable execution store. A restart resets the ledger, so
// the ceiling guards spend since the last restart, not cumulative history.

import { costFor } from "@ANCIENT/infrastructure/providers";
import type { UsageTokens } from "@ANCIENT/infrastructure/providers";
import { makeError, type ErrorEnvelope } from "@ANCIENT/contracts";

/** Env var for the platform spend ceiling, US dollars (decimal). Unset = unlimited. */
export const COST_CEILING_USD_ENV = "ANCIENT_COST_CEILING_USD";

/** Membership of the closed ErrorCode taxonomy via the canonical envelope. */
export class CostCeilingExceededError extends Error {
  readonly envelope: ErrorEnvelope;

  constructor(spendUsd: number, ceilingUsd: number, traceId?: string) {
    const message = `platform cost ceiling reached ($${spendUsd.toFixed(4)} of $${ceilingUsd.toFixed(4)})`;
    super(message);
    this.name = "CostCeilingExceededError";
    this.envelope = makeError({
      code: "BILLING_COST_CEILING_EXCEEDED",
      domain: "gateway",
      message,
      clientMessage:
        "The platform cost ceiling has been reached. Platform-billed runs are paused until the administrator raises the ceiling.",
      partialEffect: "none",
      traceId,
    });
  }
}

export type CostLedgerOptions = {
  /** USD ceiling; parse from env when omitted. Negative/NaN → unlimited. */
  ceilingUsd?: number | null;
};

export type SpendSnapshot = {
  spendUsd: number;
  ceilingUsd: number | null;
  active: boolean;
  over: boolean;
};

export function parseCeilingUsd(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * In-memory per-deployment spend accumulator. `record` is idempotent per call
 * site (executions call it once at settlement); `check` is the start-gate.
 */
export class CostLedger {
  #ceilingUsd: number | null;
  #spendUsd = 0;

  constructor(options: CostLedgerOptions = {}) {
    this.#ceilingUsd = options.ceilingUsd ?? parseCeilingUsd(process.env[COST_CEILING_USD_ENV]);
  }

  spendUsd(): number {
    return this.#spendUsd;
  }

  ceilingUsd(): number | null {
    return this.#ceilingUsd;
  }

  snapshot(): SpendSnapshot {
    const ceiling = this.#ceilingUsd;
    return {
      spendUsd: this.#spendUsd,
      ceilingUsd: ceiling,
      active: ceiling !== null,
      over: ceiling !== null && this.#spendUsd >= ceiling,
    };
  }

  /** Start-gate: would a platform-billed run be allowed under the ceiling? */
  withinCeiling(): boolean {
    return this.#ceilingUsd === null || this.#spendUsd < this.#ceilingUsd;
  }

  /**
   * Accumulate spend for a completed platform-billed run. Returns the
   * computed cost (0 when the model has no catalog pricing — never assume
   * free from a zero, check {@link CostLedger.costReported} if needed).
   */
  record(modelId: string, usage: UsageTokens): number {
    const breakdown = costFor(modelId, usage);
    this.#spendUsd += breakdown.totalUsd;
    return breakdown.totalUsd;
  }

  /** Test hook. */
  reset(): void {
    this.#spendUsd = 0;
  }
}