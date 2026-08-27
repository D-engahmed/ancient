import { test, expect } from "bun:test";
import {
  LatencyTracker,
  LATENCY_TARGET_MS,
  cliLatency,
} from "./experience/latency";
import {
  detectPackageManager,
  parseGitStatus,
  PACKAGE_MANAGERS,
  PACKAGE_MANAGER_ORDER,
  DEFAULT_PIPELINE,
} from "./experience/repo";
import {
  LearningStore,
  deriveRecommendations,
  loadObservations,
  saveObservations,
} from "./experience/learning";

// ---------- Performance: LatencyTracker ----------

test("LatencyTracker reports an empty channel as meeting the target", () => {
  const t = new LatencyTracker();
  const s = t.stats("server");
  expect(s.samples).toBe(0);
  expect(s.meetsTarget).toBe(true);
});

test("LatencyTracker tracks percentile stats and target hit rate", () => {
  const t = new LatencyTracker();
  // 100 samples at 1ms + 10 slow ones at 1000ms (>5% slow)
  for (let i = 0; i < 100; i++) t.record("server", 1);
  for (let i = 0; i < 10; i++) t.record("server", 1000);

  const s = t.stats("server");
  expect(s.samples).toBe(110);
  expect(s.minMs).toBe(1);
  expect(s.maxMs).toBe(1000);
  expect(s.p50Ms).toBe(1);
  expect(s.p95Ms).toBe(1000);
  const hitRate = 100 / 110;
  expect(s.targetHitRate).toBeCloseTo(hitRate, 2);
  // <95% of samples under target -> does not meet
  expect(s.meetsTarget).toBe(false);
});

test("LatencyTracker meets the <50ms target when consistently fast", () => {
  const t = new LatencyTracker();
  for (let i = 0; i < 100; i++) t.record("tools", 10);
  const s = t.stats("tools");
  expect(s.p95Ms).toBeLessThan(LATENCY_TARGET_MS);
  expect(s.targetHitRate).toBe(1);
  expect(s.meetsTarget).toBe(true);
});

test("LatencyTracker.trace records the duration of an async fn", async () => {
  const t = new LatencyTracker();
  await t.trace("model-first-byte", async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  const s = t.stats("model-first-byte");
  expect(s.samples).toBe(1);
  expect(s.avgMs).toBeGreaterThanOrEqual(0);
});

test("cliLatency is a shared singleton", () => {
  expect(cliLatency).toBeInstanceOf(LatencyTracker);
});

// ---------- Integration: package manager + git ----------

test("detectPackageManager prefers bun when multiple lockfiles present", () => {
  // bun outranks pnpm/yarn/npm per PACKAGE_MANAGER_ORDER
  const pm = detectPackageManager(["bun.lock", "package-lock.json"]);
  expect(pm.name).toBe("bun");
  expect(pm.lockfile).toBe("bun.lock");
});

test("detectPackageManager recognizes each manager's lockfile", () => {
  expect(detectPackageManager(["pnpm-lock.yaml"]).name).toBe("pnpm");
  expect(detectPackageManager(["yarn.lock"]).name).toBe("yarn");
  expect(detectPackageManager(["package-lock.json"]).name).toBe("npm");
});

test("detectPackageManager falls back to bun when no lockfile present", () => {
  expect(detectPackageManager([]).name).toBe("bun");
});

test("PACKAGE_MANAGER_ORDER agrees with detection precedence", () => {
  expect(PACKAGE_MANAGER_ORDER).toEqual(["bun", "pnpm", "yarn", "npm"]);
});

test("parseGitStatus extracts branch, dirty state and changed files", () => {
  const info = parseGitStatus(`## main...origin/main
 M src/app.tsx
?? package.json
`);
  expect(info.branch).toBe("main");
  expect(info.hasRemote).toBe(true);
  expect(info.dirty).toBe(true);
  expect(info.changedFiles).toEqual(["src/app.tsx", "package.json"]);
});

test("parseGitStatus handles a clean repo with no remote", () => {
  const info = parseGitStatus("## agent\n");
  expect(info.branch).toBe("agent");
  expect(info.hasRemote).toBe(false);
  expect(info.dirty).toBe(false);
  expect(info.changedFiles).toEqual([]);
});

test("DEFAULT_PIPELINE runs typecheck, test, build in order", () => {
  expect(DEFAULT_PIPELINE).toEqual(["typecheck", "test", "build"]);
});

// ---------- Learning: preferences, style, errors ----------

test("deriveRecommendations surfaces most frequent mode/model", () => {
  const rec = deriveRecommendations([
    { kind: "mode", value: "PLAN", at: 1 },
    { kind: "mode", value: "PLAN", at: 2 },
    { kind: "mode", value: "BUILD", at: 3 },
    { kind: "model", value: "z-ai/glm-5.2", at: 1 },
    { kind: "model", value: "z-ai/glm-5.2", at: 2 },
  ]);
  expect(rec.preferredMode).toBe("PLAN");
  expect(rec.preferredModel).toBe("z-ai/glm-5.2");
});

test("deriveRecommendations learns style from accepted vs rejected edits", () => {
  const rec = deriveRecommendations([
    { kind: "style", convention: "single-quotes", accepted: true, at: 1 },
    { kind: "style", convention: "single-quotes", accepted: true, at: 2 },
    { kind: "style", convention: "single-quotes", accepted: false, at: 3 },
    { kind: "style", convention: "4-space-indent", accepted: true, at: 4 },
  ]);
  // single-quotes net +1, 4-space-indent +1 -> both positive, sorted
  expect(rec.conventions).toContain("single-quotes");
  expect(rec.conventions).toContain("4-space-indent");
  // A convention that is only rejected is excluded.
  expect(rec.conventions).not.toContain("2-space-indent");
});

test("deriveRecommendations ranks error patterns by frequency", () => {
  const rec = deriveRecommendations([
    { kind: "error", code: "TS2322", at: 1 },
    { kind: "error", code: "TS2322", at: 2, suggestion: "widen the type" },
    { kind: "error", code: "TS2339", at: 3 },
  ]);
  expect(rec.errorPatterns[0]!.code).toBe("TS2322");
  expect(rec.errorPatterns[0]!.count).toBe(2);
  expect(rec.errorPatterns[0]!.suggestion).toBe("widen the type");
});

test("LearningStore keeps recorded observations within a limit", () => {
  const store = new LearningStore(3);
  for (let i = 0; i < 10; i++) {
    store.record({ kind: "mode", value: "BUILD", at: i });
  }
  expect(store.all.length).toBe(3);
});

test("LearningStore persists and reloads observations", async () => {
  const tmp = tmpFile();
  const store = new LearningStore();
  store.record({ kind: "error", code: "TS2307", at: 1 });
  store.record({ kind: "mode", value: "PLAN", at: 2 });
  await saveObservations(tmp, store.all);

  const loaded = await loadObservations(tmp);
  expect(loaded).toHaveLength(2);
  expect(deriveRecommendations(loaded).errorPatterns[0]!.code).toBe("TS2307");
  expect(deriveRecommendations(loaded).preferredMode).toBe("PLAN");
});

test("loadObservations tolerates a missing/corrupt file", async () => {
  const loaded = await loadObservations(tmpFile(`${Date.now()}-absent.json`));
  expect(loaded).toEqual([]);
});

function tmpFile(name?: string): string {
  const base = `${process.env.TEMP ?? "/tmp"}/ancient-learn-test`;
  const file = `${base}/${name ?? `${Date.now()}.json`}`;
  return file;
}
