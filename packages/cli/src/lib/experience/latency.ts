// packages/cli/src/lib/experience/latency.ts
//
// Perceived-latency tracking for the CLI experience. The mindmap target is
// <50ms first-byte/latency. This module tracks round-trip samples per
// "channel" (e.g. "server", "tools"), computes rolling percentiles, and can
// report whether the channel stays under the target.

export type LatencyChannel = "server" | "tools" | "model-first-byte";

export const LATENCY_TARGET_MS = 50;

export type LatencySample = {
  channel: LatencyChannel;
  durationMs: number;
  at: number;
};

export type LatencyStats = {
  channel: LatencyChannel;
  samples: number;
  countAtOrAbove: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  /** percentage of samples meeting the <50ms target */
  targetHitRate: number;
  meetsTarget: boolean;
};

const TARGET_SLOP_MS = 1;

export class LatencyTracker {
  private samples: Map<LatencyChannel, number[]> = new Map();
  private maxSamples: number;

  constructor(maxSamples = 200) {
    this.maxSamples = maxSamples;
  }

  /** Record a completed operation duration. */
  record(channel: LatencyChannel, durationMs: number): void {
    const list = this.samples.get(channel) ?? [];
    list.push(durationMs);
    while (list.length > this.maxSamples) list.shift();
    this.samples.set(channel, list);
  }

  /** Track an async operation's duration automatically. */
  async trace<T>(channel: LatencyChannel, fn: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await fn();
    } finally {
      this.record(channel, performance.now() - started);
    }
  }

  stats(channel: LatencyChannel): LatencyStats {
    const list = [...(this.samples.get(channel) ?? [])].sort((a, b) => a - b);
    if (list.length === 0) {
      return {
        channel,
        samples: 0,
        countAtOrAbove: 0,
        minMs: 0,
        maxMs: 0,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        targetHitRate: 1,
        meetsTarget: true,
      };
    }

    const minMs = list[0]!;
    const maxMs = list[list.length - 1]!;
    const avgMs = list.reduce((a, b) => a + b, 0) / list.length;
    const countAtOrAbove = list.filter((v) => v >= LATENCY_TARGET_MS).length;
    const targetHitRate = 1 - countAtOrAbove / list.length;

    const percentile = (p: number): number => {
      if (list.length === 1) return list[0]!;
      const idx = Math.min(list.length - 1, Math.floor((p / 100) * list.length));
      return list[idx]!;
    };

    const p50Ms = percentile(50);
    const p95Ms = percentile(95);

    return {
      channel,
      samples: list.length,
      countAtOrAbove,
      minMs,
      maxMs,
      avgMs,
      p50Ms,
      p95Ms,
      targetHitRate,
      meetsTarget: targetHitRate >= 0.95 && p95Ms < LATENCY_TARGET_MS + TARGET_SLOP_MS,
    };
  }
}

// A module-level shared tracker for the running CLI.
export const cliLatency = new LatencyTracker();
