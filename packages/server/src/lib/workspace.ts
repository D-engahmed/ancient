// file: packages/server/src/lib/workspace.ts
// Locates ANCIENT's configuration roots: a per-project `.ancient/` directory
// and a per-user `~/.ancient/` directory — same mental model as Claude Code's
// `.claude/` + `~/.claude/`.

import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";

/** User-global config root: ~/.ancient */
export function globalConfigDir(): string {
    return join(homedir(), ".ancient");
}

/** Project-local config root: <cwd>/.ancient (may not exist). */
export function projectConfigDir(cwd: string): string {
    return join(cwd, ".ancient");
}

/**
 * All skill directories that apply to a workspace, lowest precedence first.
 * Project skills shadow global skills with the same name.
 */
export function skillDirs(cwd: string | null): string[] {
    const dirs = [join(globalConfigDir(), "skills")];
    if (cwd) dirs.push(join(projectConfigDir(cwd), "skills"));
    return dirs.filter((d) => existsSync(d));
}

/** Agent definition directories (global first, project last = higher precedence). */
export function agentDirs(cwd: string | null): string[] {
    const dirs = [join(globalConfigDir(), "agents")];
    if (cwd) dirs.push(join(projectConfigDir(cwd), "agents"));
    return dirs.filter((d) => existsSync(d));
}

/** Slash-command directories (global first, project last = higher precedence). */
export function commandDirs(cwd: string | null): string[] {
    const dirs = [join(globalConfigDir(), "commands")];
    if (cwd) dirs.push(join(projectConfigDir(cwd), "commands"));
    return dirs.filter((d) => existsSync(d));
}

/** Settings files, merged global <- project. Either may be absent. */
export function settingsPaths(cwd: string | null): string[] {
    const paths = [join(globalConfigDir(), "settings.json")];
    if (cwd) paths.push(join(projectConfigDir(cwd), "settings.json"));
    return paths.filter((p) => existsSync(p));
}

/** MCP config files: ~/.ancient/.mcp.json and <cwd>/.mcp.json (Claude Code convention). */
export function mcpConfigPaths(cwd: string | null): string[] {
    const paths = [join(globalConfigDir(), ".mcp.json")];
    if (cwd) paths.push(join(cwd, ".mcp.json"));
    return paths.filter((p) => existsSync(p));
}
