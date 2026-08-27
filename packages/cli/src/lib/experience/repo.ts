// packages/cli/src/lib/experience/repo.ts
//
// Workspace integration for the CLI experience mindmap:
//   - Native Git workflow support (repo state, dirty files, branch)
//   - Package-manager awareness (detect npm/yarn/pnpm/bun from lockfiles)
//   - CI/CD pipeline triggers (run the repo's typecheck/test/build)

export type PackageManager = {
  name: "npm" | "yarn" | "pnpm" | "bun";
  lockfile: string;
  install: string;
  run: (script: string) => string[];
};

export const PACKAGE_MANAGERS: Record<PackageManager["name"], PackageManager> = {
  npm: { name: "npm", lockfile: "package-lock.json", install: "npm install", run: (s) => ["npm", "run", s] },
  yarn: { name: "yarn", lockfile: "yarn.lock", install: "yarn install", run: (s) => ["yarn", s] },
  pnpm: { name: "pnpm", lockfile: "pnpm-lock.yaml", install: "pnpm install", run: (s) => ["pnpm", "run", s] },
  bun: { name: "bun", lockfile: "bun.lock", install: "bun install", run: (s) => ["bun", "run", s] },
};

export const PACKAGE_MANAGER_ORDER: PackageManager["name"][] = ["bun", "pnpm", "yarn", "npm"];

/**
 * Detect the package manager in use for a directory based purely on which
 * lockfiles are present (pure function — no filesystem access, for testing).
 */
export function detectPackageManager(lockfiles: string[]): PackageManager {
  const set = new Set(lockfiles);
  if (set.has(PACKAGE_MANAGERS.bun.lockfile)) return PACKAGE_MANAGERS.bun;
  if (set.has(PACKAGE_MANAGERS.pnpm.lockfile)) return PACKAGE_MANAGERS.pnpm;
  if (set.has(PACKAGE_MANAGERS.yarn.lockfile)) return PACKAGE_MANAGERS.yarn;
  if (set.has(PACKAGE_MANAGERS.npm.lockfile)) return PACKAGE_MANAGERS.npm;
  // Fall back to bun (default when no lockfile is present).
  return PACKAGE_MANAGERS.bun;
}

/**
 * Known pipeline scripts, in priority order, that a CI/CD trigger can run.
 */
export const PIPELINE_SCRIPTS: ReadonlyArray<string> = [
  "typecheck",
  "test",
  "lint",
  "check",
  "build",
];

/** Maps a canonical CI/CD stage to a script name, with fallbacks. */
export function canonicalScript(stage: "typecheck" | "test" | "build" | "lint"): string {
  return stage;
}

/** The default pipeline: the ordered stages most repos expose. */
export const DEFAULT_PIPELINE: Array<"typecheck" | "test" | "build"> = [
  "typecheck",
  "test",
  "build",
];

export type GitStatusShape = {
  branch: string | null;
  dirty: boolean;
  changedFiles: string[];
  hasRemote: boolean;
};

/**
 * Parse `git status --short --branch` output into a structured shape (pure).
 */
export function parseGitStatus(output: string): GitStatusShape {
  const lines = output.split("\n").filter((l) => l.trim() !== "");
  let branch: string | null = null;
  let changed = 0;
  let hasRemote = false;

  for (const line of lines) {
    // e.g. "## main...origin/main"
    if (line.startsWith("## ")) {
      const rest = line.slice(3);
      const afterBracket = rest.includes("[") ? rest.slice(0, rest.indexOf("[")) : rest;
      const remoteMarker = rest.includes("...");
      hasRemote = remoteMarker;
      if (remoteMarker) {
        branch = afterBracket.split("...")[0]!.trim();
      } else {
        branch = afterBracket.trim();
      }
      continue;
    }
    // Any other line ( " M file.ts", "?? new.txt" ) counts as a change.
    if (line.length > 0) changed += 1;
  }

  return {
    branch,
    dirty: changed > 0,
    changedFiles: (() => {
      const list: string[] = [];
      for (const line of lines) {
        if (line.startsWith("## ")) continue;
        // Format: <XY> <path>
        const path = line.slice(3).trim();
        if (path) list.push(path);
      }
      return list;
    })(),
    hasRemote,
  };
}
