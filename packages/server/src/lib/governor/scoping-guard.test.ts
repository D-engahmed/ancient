import { test, expect } from "bun:test";
import { createScopingGuard } from "./scoping-guard";

test("allows CLI UI files alongside config files", () => {
    const guard = createScopingGuard();
    expect(guard.checkScope("packages/cli/src/screens/home.tsx")).toBeNull();
    expect(guard.checkScope("package.json")).toBeNull();
    expect(guard.checkScope("packages/cli/src/components/input-bar.tsx")).toBeNull();
});

test("blocks CLI UI + server-side orchestration change in one step", () => {
    const guard = createScopingGuard();
    expect(guard.checkScope("packages/cli/src/screens/home.tsx")).toBeNull();
    const violation = guard.checkScope("packages/server/src/routes/chat.ts");
    expect(violation).not.toBeNull();
    expect(violation).toContain("Write File blocked");
    expect(violation).toContain("mixes CLI UI changes with server-side orchestration");
});

test("blocks schema change + UI work in one step", () => {
    const guard = createScopingGuard();
    expect(guard.checkScope("packages/database/prisma/schema.prisma")).toBeNull();
    const violation = guard.checkScope("packages/cli/src/screens/home.tsx");
    expect(violation).not.toBeNull();
    expect(violation).toContain("mixes a schema change with UI work");
});

test("blocks two unrelated route handlers in one step", () => {
    const guard = createScopingGuard();
    expect(guard.checkScope("packages/server/src/routes/chat.ts")).toBeNull();
    const violation = guard.checkScope("packages/server/src/routes/agent.ts");
    expect(violation).not.toBeNull();
    expect(violation).toContain("touches two unrelated route handlers");
});

test("allows two writes to the same route handler", () => {
    const guard = createScopingGuard();
    expect(guard.checkScope("packages/server/src/routes/chat.ts")).toBeNull();
    expect(guard.checkScope("packages/server/src/routes/chat.ts")).toBeNull();
});

test("blocks two unrelated tool definitions in one step", () => {
    const guard = createScopingGuard();
    expect(guard.checkScope("packages/server/src/tools/DiffEngine.ts")).toBeNull();
    const violation = guard.checkScope("packages/server/src/tools/other.ts");
    expect(violation).not.toBeNull();
    expect(violation).toContain("touches two unrelated tool definitions");
});

test("exposes the list of touched paths", () => {
    const guard = createScopingGuard();
    guard.checkScope("packages/cli/src/screens/home.tsx");
    guard.checkScope("package.json");
    expect(guard.touchedPaths()).toEqual([
        "packages/cli/src/screens/home.tsx",
        "package.json",
    ]);
});

test("a blocked write is not recorded as touched", () => {
    const guard = createScopingGuard();
    guard.checkScope("packages/cli/src/screens/home.tsx");
    guard.checkScope("packages/server/src/routes/chat.ts");
    expect(guard.touchedPaths()).toEqual(["packages/cli/src/screens/home.tsx"]);
});
