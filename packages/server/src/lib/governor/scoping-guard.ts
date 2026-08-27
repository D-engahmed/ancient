// Destination: packages/server/src/lib/governor/scoping-guard.ts
//
// Code-level enforcement of the "When To Split Work" rules (see
// rules/scoping-rules.md). Classifies each file a Write File call touches
// and blocks a second write in the same turn if the pair matches one of the
// specific combinations the rules call out. This is a heuristic proxy for
// "same feature unit," not a perfect one — see the note at the bottom for
// how to loosen it if it's too strict for your workflow.

type ScopeTag =
    | { kind: "cli-ui" }
    | { kind: "schema" }
    | { kind: "route-handler"; file: string }
    | { kind: "tool-definition"; file: string }
    | { kind: "server-other" }
    | { kind: "config" }
    | { kind: "other" };

function classify(filePath: string): ScopeTag {
    if (/\.(json|ya?ml|env.*)$/i.test(filePath) || /docker-compose/.test(filePath)) {
        return { kind: "config" };
    }
    if (/^packages\/cli\//.test(filePath)) {
        return { kind: "cli-ui" };
    }
    if (/schema\.prisma$/.test(filePath) || /shared\/src\/schemas\.ts$/.test(filePath)) {
        return { kind: "schema" };
    }
    const routeMatch = filePath.match(/\/routes\/([^/]+)$/);
    if (routeMatch) {
        return { kind: "route-handler", file: routeMatch[1]! };
    }
    const toolMatch = filePath.match(/\/tools\/([^/]+)$/);
    if (toolMatch) {
        return { kind: "tool-definition", file: toolMatch[1]! };
    }
    if (/^packages\/server\//.test(filePath)) {
        return { kind: "server-other" };
    }
    return { kind: "other" };
}

const isServerSide = (t: ScopeTag) =>
    t.kind === "route-handler" ||
    t.kind === "tool-definition" ||
    t.kind === "server-other" ||
    t.kind === "schema";

function describeViolation(
    a: ScopeTag,
    b: ScopeTag,
    aPath: string,
    bPath: string
): string | null {
    // Rule: schema changes + unrelated feature work (proxy: schema + UI in one step).
    // Checked BEFORE the generic CLI/server rule because a schema change is also
    // classified as server-side; this gives callers the more specific message.
    if ((a.kind === "schema" && b.kind === "cli-ui") || (b.kind === "schema" && a.kind === "cli-ui")) {
        return scopeMessage(aPath, bPath, "mixes a schema change with UI work");
    }

    // Rule: CLI UI changes + server-side orchestration changes
    if ((a.kind === "cli-ui" && isServerSide(b)) || (b.kind === "cli-ui" && isServerSide(a))) {
        return scopeMessage(aPath, bPath, "mixes CLI UI changes with server-side orchestration changes");
    }

    // Rule: multiple unrelated route handlers
    if (a.kind === "route-handler" && b.kind === "route-handler" && a.file !== b.file) {
        return scopeMessage(aPath, bPath, `touches two unrelated route handlers (${a.file} and ${b.file})`);
    }

    // Rule: multiple unrelated tool definitions
    if (a.kind === "tool-definition" && b.kind === "tool-definition" && a.file !== b.file) {
        return scopeMessage(aPath, bPath, `touches two unrelated tool definitions (${a.file} and ${b.file})`);
    }

    return null;
}

function scopeMessage(aPath: string, bPath: string, reason: string): string {
    return (
        `[Write File blocked — scope too broad] This step already touched ${aPath}. ` +
        `Writing to ${bPath} now ${reason} in a single implementation step. ` +
        `Finish and verify the current feature unit first, or tell the user this ` +
        `needs to be split into separate steps.`
    );
}

export function createScopingGuard() {
    const touched: { path: string; tag: ScopeTag }[] = [];

    function checkScope(filePath: string): string | null {
        const tag = classify(filePath);

        // Config files (package.json, .env, docker-compose) don't count as
        // feature scope — you almost always touch one of these alongside real work.
        if (tag.kind === "config") {
            touched.push({ path: filePath, tag });
            return null;
        }

        for (const prev of touched) {
            const violation = describeViolation(prev.tag, tag, prev.path, filePath);
            if (violation) return violation;
        }

        touched.push({ path: filePath, tag });
        return null;
    }

    return {
        checkScope,
        touchedPaths: () => touched.map((t) => t.path),
    };
}

// Tuning note: this only catches the specific combinations named in
// scoping-rules.md. It deliberately does NOT flag e.g. schema.prisma +
// its own route handler in the same step — that's normal, coupled work
// for one feature. If it's still too strict (or not strict enough) for
// how your team actually works, adjust `describeViolation` — that's the
// one place all the "what counts as unrelated" logic lives.