// file: packages/server/src/hooks/settings.ts
// Settings loader — `.ancient/settings.json` (project) merged over
// `~/.ancient/settings.json` (user). Holds hooks, model routing, and feature
// toggles. File-based (like Claude Code) so it versions with the repo and
// needs no DB migration.

import { readFile } from "fs/promises";
import { settingsPaths } from "../lib/workspace";
import { createLogger } from "@ANCIENT/shared";

const log = createLogger("settings");

export type HookEvent =
    | "SessionStart"
    | "UserPromptSubmit"
    | "PreToolUse"
    | "PostToolUse"
    | "Stop";

export type HookDefinition = {
    /** Tool-name matcher for PreToolUse/PostToolUse. "*" or omitted = all.
     *  Supports a trailing wildcard: "mcp__*" matches every MCP tool. */
    matcher?: string;
    /** Shell command. Receives a JSON payload on stdin. */
    command: string;
    /** Per-hook timeout in ms (default 10_000). */
    timeoutMs?: number;
};

export type ModelRoutingSettings = {
    enabled?: boolean;
    /** free-first: simple prompts go to the free model, complex ones keep the
     *  user's selection. premium: ignore the free model entirely. */
    strategy?: "free-first" | "premium";
    freeModel?: {
        baseUrl: string;          // any OpenAI-compatible endpoint
        modelId: string;          // e.g. "mistralai/devstral-2512:free" or "qwen3:14b" (Ollama)
        apiKeyEnv?: string;       // env var holding the key; omit for local servers
    };
};

export type AncientSettings = {
    hooks?: Partial<Record<HookEvent, HookDefinition[]>>;
    modelRouting?: ModelRoutingSettings;
    /** Set false to disable checkpointing for this workspace. */
    checkpoints?: { enabled?: boolean };
    /** Set false to disable MCP servers for this workspace. */
    mcp?: { enabled?: boolean };
};

export const DEFAULT_SETTINGS: AncientSettings = {
    hooks: {},
    modelRouting: { enabled: false, strategy: "premium" },
    checkpoints: { enabled: true },
    mcp: { enabled: true },
};

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Shallow merge with one nested level for the known sections. */
function mergeSettings(base: AncientSettings, override: AncientSettings): AncientSettings {
    return {
        hooks: { ...base.hooks, ...override.hooks },
        modelRouting: { ...base.modelRouting, ...override.modelRouting },
        checkpoints: { ...base.checkpoints, ...override.checkpoints },
        mcp: { ...base.mcp, ...override.mcp },
    };
}

/** Loads and merges all settings files for a workspace. Never throws. */
export async function loadSettings(cwd: string | null): Promise<AncientSettings> {
    let settings = DEFAULT_SETTINGS;
    for (const path of settingsPaths(cwd)) {
        try {
            const raw = await readFile(path, "utf-8");
            const parsed = JSON.parse(raw);
            if (isObject(parsed)) {
                settings = mergeSettings(settings, parsed as AncientSettings);
            }
        } catch (err) {
            log.warn("ignoring invalid settings file", {
                path,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return settings;
}

export function hooksFor(settings: AncientSettings, event: HookEvent): HookDefinition[] {
    return settings.hooks?.[event] ?? [];
}

/** Does a hook matcher match this tool name? Supports exact and "prefix*". */
export function matcherMatches(matcher: string | undefined, toolName: string): boolean {
    if (!matcher || matcher === "*") return true;
    if (matcher.endsWith("*")) return toolName.startsWith(matcher.slice(0, -1));
    return matcher === toolName;
}
