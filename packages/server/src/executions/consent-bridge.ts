// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 9 — Consent bridge.
//
// Bridges the server-side ConsentProvider (which the engine calls during tool
// execution) to the CLI via SSE. When the engine calls the consent provider:
//   1. The bridge emits an `approval.requested` envelope on the SSE stream.
//   2. It returns a Promise that resolves when the CLI sends a consent response.
//   3. The CLI POSTs to /executions/:id/consent with requestId + decision.
//   4. The bridge resolves the waiting Promise.
//
// This replaces the placeholder CLI_ALLOW auto-allow with real consent prompts.

import { randomUUID as createId } from "node:crypto";
import type { ConsentProvider } from "@ANCIENT/capabilities/core";
import type { ExecutionEventBridge } from "./bridge";

type PendingConsent = {
  resolve: (granted: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};

const CONSENT_TIMEOUT_MS = 120_000;

/**
 * Server-side consent provider wired to the engine. Each call emits an
 * `approval.requested` event on the bridge and waits for a consent response.
 */
export class ConsentBridge {
  #pending = new Map<string, PendingConsent>();

  /**
   * Create a ConsentProvider for a single execution run. The provider emits
   * `approval.requested` on the given bridge and resolves when the CLI responds.
   */
  createProvider(bridge: ExecutionEventBridge, executionId: string): ConsentProvider {
    return async (request) => {
      const requestId = createId();

      // Emit the approval.requested event on the SSE stream.
      bridge.emitApprovalRequested(executionId, {
        requestId,
        capability: request.toolName,
        prompt: `${request.reason}${request.target ? ` (${request.target})` : ""}`,
      });

      // Wait for the CLI response (approve/deny).
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          this.#pending.delete(requestId);
          resolve(false);
        }, CONSENT_TIMEOUT_MS);

        this.#pending.set(requestId, { resolve, timer });
      });
    };
  }

  /**
   * Called when the CLI sends a consent response (POST /executions/:id/consent).
   * Resolves the pending Promise for the given requestId.
   */
  respond(requestId: string, granted: boolean): boolean {
    const pending = this.#pending.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.#pending.delete(requestId);
    pending.resolve(granted);
    return true;
  }

  /** Number of pending consent requests (for diagnostics). */
  get pendingCount(): number {
    return this.#pending.size;
  }
}
