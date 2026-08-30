// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Layer 5 — Capability Runtime contract. Every capability must declare, up
// front, how it fails (`idempotent`, `reversible`, `errorClass`). An
// undeclared capability is rejected at registration time (Layer 5 Registry).

import type { ErrorCode } from "./error";

export type CapabilityKind =
  | "tool"
  | "skill"
  | "mcp"
  | "command"
  | "computer-use"
  | "design-tool";

/** Declared failure shape every capability must carry (Layer 5). */
export type CapabilityErrorClass =
  | "deterministic"
  | "transient"
  | "partial_effect_possible"
  | "unknown";

/** Optional cost model for budget-aware selection (Layer 19, Layer 21 §4). */
export interface CostModel {
  /** Cost per input token. */
  input?: number;
  /** Cost per output token. */
  output?: number;
  /** Cost per invocation, provider-agnostic. */
  perCall?: number;
}

/** The unified capability contract (Layer 5 "Unified contract"). */
export interface Capability {
  id: string;
  kind: CapabilityKind;
  inputSchema: unknown;
  outputSchema: unknown;
  permissions: string[];
  cost?: CostModel;
  timeout?: number;
  /** Can this be safely retried as-is? */
  idempotent: boolean;
  /** Can this be undone/compensated? */
  reversible: boolean;
  /** Declared failure shape; `unknown` default unless verified (fail safe). */
  errorClass: CapabilityErrorClass;
}

/** Standardized capability error (Layer 5). Everything fails through this shape. */
export interface CapabilityError {
  capabilityId: string;
  /** Maps into the Layer 20 ErrorCode taxonomy. */
  code: ErrorCode;
  /** Network blip vs. structural problem. */
  transient: boolean;
  /** True only if `idempotent === true` (Layer 20 decision table). */
  retryableAsIs: boolean;
  /** Did a possibly-irreversible side effect occur before failure? */
  partialEffect?: boolean;
  /** Original error object; log-only, never shown to the model. */
  raw?: unknown;
}