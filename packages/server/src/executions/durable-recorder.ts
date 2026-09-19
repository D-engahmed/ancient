// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential.
//
// Serializes lifecycle persistence so a slow database cannot reorder events.
// The first event is awaited before execution starts; subsequent events are
// queued and drained when the execution settles.

import type { LifecycleEvent } from "@ANCIENT/infrastructure/events";
import type { ExecutionEvent, ExecutionStore } from "@ANCIENT/infrastructure/storage";

export class DurableExecutionRecorder {
  #tail: Promise<void> = Promise.resolve();
  #error: unknown;

  constructor(
    private readonly store: ExecutionStore,
    private readonly userId: string,
  ) {}

  async created(executionId: string, task: string, mode: string): Promise<void> {
    await this.store.appendEvent({
      id: crypto.randomUUID(),
      executionId,
      userId: this.userId,
      type: "created",
      timestamp: new Date(),
      payload: { userId: this.userId, task, mode },
    });
  }

  record(event: LifecycleEvent): void {
    this.#tail = this.#tail.then(async () => {
      const durable: Omit<ExecutionEvent, "seq"> = {
        id: event.id,
        executionId: event.executionId,
        userId: this.userId,
        type: event.type,
        timestamp: event.timestamp,
        payload: event.payload,
      };
      await this.store.appendEvent(durable);
    }).catch((error) => {
      this.#error ??= error;
      // Keep the queue alive so later drain() observes the first failure
      // instead of silently losing the remaining lifecycle records.
    });
  }

  async drain(): Promise<void> {
    await this.#tail;
    if (this.#error) {
      throw new Error(
        `durable execution persistence failed: ${this.#error instanceof Error ? this.#error.message : String(this.#error)}`,
      );
    }
  }
}
