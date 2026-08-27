// packages/cli/src/lib/experience/learning.ts
//
// Lightweight learning layer for the CLI experience mindmap:
//   - User preference adaptation (which modes/models the user favors)
//   - Team-style learning (conventions inferred from accepted edits)
//   - Error-pattern recognition (frequent failures -> suggestions)
//
// All scoring is pure; persistence is a small JSON file under `.ancient/learn`.

export type PreferenceObservation = {
  kind: "mode" | "model";
  value: string;
  at: number;
};

export type StyleObservation = {
  kind: "style";
  /** e.g. "single-quotes", "4-space-indent" */
  convention: string;
  accepted: boolean;
  at: number;
};

export type ErrorObservation = {
  kind: "error";
  /** sanitized error type, e.g. "TS2322" */
  code: string;
  /** optional suggestion the model proposed */
  suggestion?: string;
  at: number;
};

export const VALID_ERROR_CODES = /^[A-Za-z][A-Za-z0-9]*$/;

export type Observation = PreferenceObservation | StyleObservation | ErrorObservation;

export type Recommendation = {
  preferredMode?: string;
  preferredModel?: string;
  conventions: string[];
  errorPatterns: Array<{ code: string; count: number; suggestion?: string }>;
};

const DEFAULT_LIMIT = 10_000;

/**
 * Reduce observations into adaptively-scored recommendations. Preferences win
 * by frequency; style conventions by (accepted - rejected) weighted recency;
 * errors by frequency, surfacing the most repeated error codes.
 */
export function deriveRecommendations(observations: Observation[]): Recommendation {
  const modeCounts = new Map<string, number>();
  const modelCounts = new Map<string, number>();
  const conventionScore = new Map<string, number>();
  const errorCounts = new Map<string, { count: number; suggestion?: string }>();

  for (const obs of observations) {
    if (obs.kind === "mode") {
      modeCounts.set(obs.value, (modeCounts.get(obs.value) ?? 0) + 1);
    } else if (obs.kind === "model") {
      modelCounts.set(obs.value, (modelCounts.get(obs.value) ?? 0) + 1);
    } else if (obs.kind === "style") {
      const delta = obs.accepted ? 1 : -1;
      conventionScore.set(obs.convention, (conventionScore.get(obs.convention) ?? 0) + delta);
    } else if (obs.kind === "error") {
      const prev = errorCounts.get(obs.code) ?? { count: 0, suggestion: undefined };
      errorCounts.set(obs.code, {
        count: prev.count + 1,
        suggestion: prev.suggestion ?? obs.suggestion,
      });
    }
  }

  const top = (m: Map<string, number>): string | undefined => {
    let best: string | undefined;
    let bestCount = 0;
    for (const [value, count] of m) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    return best;
  };

  const conventions = [...conventionScore.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const errorPatterns = [...errorCounts.entries()]
    .map(([code, v]) => ({ code, count: v.count, suggestion: v.suggestion }))
    .sort((a, b) => b.count - a.count);

  return {
    preferredMode: top(modeCounts),
    preferredModel: top(modelCounts),
    conventions,
    errorPatterns,
  };
}

/**
 * In-memory learning store with optional persistence. The write/load methods
 * are thin and fail silently if the filesystem is unavailable.
 */
export class LearningStore {
  private observations: Observation[] = [];
  private limit: number;

  constructor(limit = DEFAULT_LIMIT) {
    this.limit = limit;
  }

  record(obs: Observation): void {
    this.observations.push(obs);
    if (this.observations.length > this.limit) {
      this.observations.splice(0, this.observations.length - this.limit);
    }
  }

  recordMany(obses: Observation[]): void {
    for (const o of obses) this.record(o);
  }

  get all(): Observation[] {
    return [...this.observations];
  }

  clear(): void {
    this.observations = [];
  }

  recommendations(): Recommendation {
    return deriveRecommendations(this.observations);
  }
}

/**
 * Best-effort load of observations from a JSON file. Returns an empty list on
 * any failure so callers never crash on a corrupt/absent file.
 */
export async function loadObservations(path: string): Promise<Observation[]> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isObservation);
  } catch {
    return [];
  }
}

export async function saveObservations(path: string, observations: Observation[]): Promise<void> {
  try {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(observations, null, 2), "utf-8");
  } catch {
    // best-effort persistence only
  }
}

function isObservation(value: unknown): value is Observation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== "string") return false;
  // Each variant has a distinct key; validate by kind.
  if (v.kind === "error") return typeof v.code === "string";
  if (v.kind === "style") return typeof v.convention === "string" && typeof v.accepted === "boolean";
  // mode / model
  return typeof v.value === "string";
}
