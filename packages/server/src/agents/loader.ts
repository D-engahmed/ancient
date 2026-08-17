// file: packages/server/src/agents/loader.ts
// Subagents — markdown-defined specialists the main agent can delegate to via
// the `task` tool. Each subagent runs with its own isolated context window
// (its exploration never pollutes the main conversation — the single biggest
// token saver in agentic coding), its own tool allow-list, and an optional
// cheaper model.

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { parseFrontmatter, parseList } from "../lib/frontmatter";
import { agentDirs } from "../lib/workspace";

export type AgentModelPreference =
    | { kind: "inherit" }   // use the session's model
    | { kind: "cheap" };    // route to the configured free/local model

export type AgentDefinition = {
    name: string;
    /** One-liner used by the main agent to decide when to delegate. */
    description: string;
    /** Tool allow-list. Empty = all tools available in the current mode. */
    tools: string[];
    model: AgentModelPreference;
    /** The agent's system prompt (markdown body). */
    instructions: string;
    source: "global" | "project" | "builtin";
};

const MAX_INSTRUCTION_CHARS = 12_000;

/** Built-in agents that are always available — users can shadow them by
 *  reusing the same name in ~/.ancient/agents or .ancient/agents. */
const BUILTIN_AGENTS: AgentDefinition[] = [
    {
        name: "explore",
        description: "Fast read-only codebase investigator. Delegate 'where is X / how does Y work' questions to keep search noise out of the main context.",
        tools: ["readFile", "listDirectory", "glob", "grep"],
        model: { kind: "cheap" },
        instructions: `You are a codebase exploration specialist. Answer the question you are given by searching the codebase efficiently: start with glob/grep to locate candidates, then read only the files that matter. Never modify anything. End with a concise report: relevant file paths (with line numbers where useful), how the pieces connect, and a direct answer to the question. Do not editorialize.`,
        source: "builtin",
    },
    {
        name: "review",
        description: "Code reviewer. Delegate after making changes to catch bugs, regressions, and style violations before the user sees them.",
        tools: ["readFile", "listDirectory", "glob", "grep", "bash"],
        model: { kind: "inherit" },
        instructions: `You are a senior code reviewer. Review the changes or files described in the task. Look for: correctness bugs, edge cases, security issues, broken contracts with existing code, and violations of project conventions. Run read-only inspection commands (git diff, tests) via bash when useful — never modify files. Report findings ordered by severity, each with file:line and a concrete fix suggestion. If everything looks good, say so explicitly.`,
        source: "builtin",
    },
    {
        name: "test",
        description: "Test writer/runner. Delegate to generate tests for a module or to run the test suite and summarize failures.",
        tools: ["readFile", "listDirectory", "glob", "grep", "writeFile", "editFile", "bash"],
        model: { kind: "inherit" },
        instructions: `You are a testing specialist. For the given task: find the project's test framework and conventions first (read existing tests), then write or run tests as asked. Match the existing style exactly. When running tests, report failures with the smallest useful excerpt of output, not the whole log.`,
        source: "builtin",
    },
];

async function readAgentFile(path: string, source: "global" | "project"): Promise<AgentDefinition | null> {
    try {
        const raw = await readFile(path, "utf-8");
        const { data, body } = parseFrontmatter(raw);
        const name = data.name?.trim() || path.split(/[\\/]/).pop()!.replace(/\.md$/i, "");
        const modelPref = (data.model ?? "").trim().toLowerCase();
        return {
            name,
            description: (data.description ?? "").trim().slice(0, 300),
            tools: parseList(data.tools),
            model: modelPref === "cheap" || modelPref === "free" || modelPref === "local"
                ? { kind: "cheap" }
                : { kind: "inherit" },
            instructions: body.length > MAX_INSTRUCTION_CHARS
                ? body.slice(0, MAX_INSTRUCTION_CHARS) + "\n... (agent instructions truncated)"
                : body,
            source,
        };
    } catch {
        return null;
    }
}

/**
 * All agents available in a workspace: built-ins, then global, then project
 * (later sources shadow earlier ones by name).
 */
export async function listAgents(cwd: string | null): Promise<AgentDefinition[]> {
    const byName = new Map<string, AgentDefinition>();
    for (const a of BUILTIN_AGENTS) byName.set(a.name, a);

    for (const root of agentDirs(cwd)) {
        const source = cwd && root.startsWith(cwd) ? "project" as const : "global" as const;
        let entries: string[];
        try {
            entries = await readdir(root);
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.toLowerCase().endsWith(".md")) continue;
            const agent = await readAgentFile(join(root, entry), source);
            if (agent) byName.set(agent.name, agent);
        }
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAgent(cwd: string | null, name: string): Promise<AgentDefinition | null> {
    const agents = await listAgents(cwd);
    return agents.find((a) => a.name === name) ?? null;
}

/** Token-lean index for the system prompt — one line per agent. */
export function buildAgentsPromptBlock(agents: AgentDefinition[]): string {
    if (agents.length === 0) return "";
    const lines = agents.map(
        (a) => `- **${a.name}**${a.source === "builtin" ? "" : ` (${a.source})`} — ${a.description || "custom agent"}`,
    );
    return [
        "## Subagents",
        "Specialized agents you can delegate to with the `task` tool. A subagent works in its OWN isolated context and returns only its final report — delegate exploration, review, and test-running to keep this conversation's context small.",
        ...lines,
    ].join("\n");
}
