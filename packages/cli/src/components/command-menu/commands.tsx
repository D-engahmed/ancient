// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. 
// file: packages/cli/src/components/command-menu/commands.tsx

import {
  AgentsDialogContent,
  AgentsDialogListContent,
  CheckpointsDialogContent,
  CommandsDialogContent,
  McpDialogContent,
  ModelsDialogContent,
  SessionsDialogContent,
  SkillsDialogContent,
  ThemeDialogContent,
  UsageDialogContent,
} from "../dialogs/index";
import { apiClient } from "../../lib/api-client";
import type { Command } from "./types";

import { performLogin } from "../../lib/oauth";
import { clearAuth } from "../../lib/auth";
import {
  getWorkspaceInfo,
  cliLatency,
  openLearningStore,
  defaultLearningFile,
} from "../../lib/experience";

async function pollPipeline(id: string, ctx: Parameters<NonNullable<Command["action"]>>[0]): Promise<void> {
  const deadline = Date.now() + 120_000;
  const poll = async (): Promise<void> => {
    try {
      const status = await apiClient.pipeline.status(id);
      if (status.status === "succeeded" || status.status === "failed") {
        const result = status.result as { pm?: string | null; stages?: Array<{ script: string; ok: boolean }> } | undefined;
        if (status.status === "failed") {
          ctx.toast.show({ variant: "error", message: `Pipeline failed: ${status.error ?? "unknown error"}` });
          return;
        }
        const stageSummary =
          result?.stages?.map((s) => `${s.script}:${s.ok ? "✓" : "✗"}`).join("  ") ?? "";
        ctx.toast.show({
          variant: "success",
          message: `Pipeline done (${result?.pm ?? "?"}) — ${stageSummary}`,
          duration: 5000,
        });
        return;
      }
      if (Date.now() > deadline) {
        ctx.toast.show({ variant: "info", message: "Pipeline still running in the background" });
        return;
      }
      setTimeout(() => void poll(), 2000);
    } catch {
      ctx.toast.show({ variant: "info", message: "Pipeline is running in the background" });
    }
  };
  void poll();
}

export const COMMANDS: Command[] = [
  {
    name: "new",
    description: "Start a new conversation",
    value: "/new",
    action: (ctx) => {
      ctx.navigate("/");
    },
  },
  {
    name: "agents",
    description: "Switch agents",
    value: "/agents",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Agent",
        children: <AgentsDialogContent currentMode={ctx.mode} onSelectMode={ctx.setMode} />,
      })
    },
  },
  {
    name: "models",
    description: "Select a model or add a connection",
    value: "/models",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Model",
        children: <ModelsDialogContent />,
      })
    },
  },
  {
    name: "usage",
    description: "View request usage against each connection's known rate limit",
    value: "/usage",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Usage",
        children: <UsageDialogContent />,
      })
    },
  },
  {
    name: "sessions",
    description: "Browse past sessions",
    value: "/sessions",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Sessions",
        children: <SessionsDialogContent />,
      })
    },
  },
  {
    name: "skills",
    description: "Browse installed skills",
    value: "/skills",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Skills",
        children: <SkillsDialogContent cwd={ctx.cwd} />,
      })
    },
  },
  {
    name: "prompts",
    description: "Browse prompt slash-commands (/review, /fix, ...)",
    value: "/prompts",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Prompt Commands",
        children: <CommandsDialogContent cwd={ctx.cwd} />,
      })
    },
  },
  {
    name: "subagents",
    description: "Browse subagents available for delegation",
    value: "/subagents",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Subagents",
        children: <AgentsDialogListContent cwd={ctx.cwd} />,
      })
    },
  },
  {
    name: "mcp",
    description: "Show MCP server connections",
    value: "/mcp",
    action: (ctx) => {
      ctx.dialog.open({
        title: "MCP Servers",
        children: <McpDialogContent cwd={ctx.cwd} />,
      })
    },
  },
  {
    name: "compact",
    description: "Compact this session's history into a summary",
    value: "/compact",
    action: async (ctx) => {
      if (!ctx.sessionId) {
        ctx.toast.show({ variant: "error", message: "Open a session first" });
        return;
      }
      ctx.toast.show({ message: "Compacting conversation..." });
      try {
        const result = await apiClient.extensions.compact(ctx.sessionId);
        ctx.toast.show({
          variant: "success",
          message: `Compacted ${result.summarizedMessages ?? ""} messages with ${result.model ?? "model"}`,
        });
      } catch (error) {
        ctx.toast.show({
          variant: "error",
          message: error instanceof Error ? error.message : "Compaction failed",
        });
      }
    },
  },
  {
    name: "rewind",
    description: "Restore files & history to an earlier checkpoint",
    value: "/rewind",
    action: (ctx) => {
      if (!ctx.sessionId) {
        ctx.toast.show({ variant: "error", message: "Open a session first" });
        return;
      }
      ctx.dialog.open({
        title: "Rewind to checkpoint",
        children: <CheckpointsDialogContent sessionId={ctx.sessionId} />,
      })
    },
  },
  {
    name: "theme",
    description: "Change color theme",
    value: "/theme",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Theme",
        children: <ThemeDialogContent />,
      })
    },
  },
  {
    name: "login",
    description: "Sign in with your browser",
    value: "/login",
    action: async (ctx) => {
      ctx.toast.show({ message: "Opening browser to sign in..." });

      try {
        await performLogin();
        ctx.toast.show({ variant: "success", message: "Signed in" });
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "Sign in failed or timed out";

        ctx.toast.show({ variant: "error", message });
      }
    },
  },
  {
    name: "logout",
    description: "Sign out of your account",
    value: "/logout",
    action: (ctx) => {
      clearAuth();
      ctx.toast.show({ variant: "success", message: "Signed out" });
    },
  },
  {
    name: "workspace",
    description: "Show git branch, package manager, and latency for this workspace",
    value: "/workspace",
    action: async (ctx) => {
      const cwd = ctx.cwd ?? process.cwd();
      ctx.toast.show({ message: "Scanning workspace..." });
      try {
        const info = await getWorkspaceInfo(cwd);
        const stats = cliLatency.stats("server");
        const gitPart = info.git
          ? `${info.git.branch ?? "no-branch"}${info.git.dirty ? " (dirty)" : ""}`
          : "not a git repo";
        const pmPart = info.packageManager?.name ?? "none detected";
        const latencyPart =
          stats.samples > 0
            ? `${Math.round(stats.p95Ms)}ms p95${stats.meetsTarget ? " ✓" : " ✗ (<50ms)"}`
            : "no samples yet";
        ctx.toast.show({
          variant: "success",
          message: `git: ${gitPart} · pm: ${pmPart} · server p95: ${latencyPart}`,
          duration: 5000,
        });
      } catch (error) {
        ctx.toast.show({
          variant: "error",
          message: error instanceof Error ? error.message : "Failed to read workspace",
        });
      }
    },
  },
  {
    name: "pipeline",
    description: "Run the repo pipeline (typecheck/test/build) in the background",
    value: "/pipeline",
    action: async (ctx) => {
      const cwd = ctx.cwd ?? process.cwd();
      ctx.toast.show({ message: "Starting pipeline in the background..." });
      try {
        const { id } = await apiClient.pipeline.start(cwd);
        ctx.toast.show({ message: `Pipeline started (${id}) — polling...` });
        void pollPipeline(id, ctx);
      } catch (error) {
        ctx.toast.show({
          variant: "error",
          message: error instanceof Error ? error.message : "Failed to start pipeline",
        });
      }
    },
  },
  {
    name: "style",
    description: "Show learned conventions and error patterns for this workspace",
    value: "/style",
    action: async (ctx) => {
      const cwd = ctx.cwd ?? process.cwd();
      try {
        const store = await openLearningStore(defaultLearningFile(cwd));
        const rec = store.recommendations();
        const parts: string[] = [];
        if (rec.preferredMode) parts.push(`mode: ${rec.preferredMode}`);
        if (rec.conventions.length) parts.push(`style: ${rec.conventions.slice(0, 3).join(", ")}`);
        const topError = rec.errorPatterns[0];
        if (topError) parts.push(`top error: ${topError.code} (${topError.count}x)`);
        ctx.toast.show({
          variant: "success",
          message: parts.length ? parts.join(" · ") : "No learned patterns yet — keep working!",
          duration: 5000,
        });
      } catch (error) {
        ctx.toast.show({
          variant: "error",
          message: error instanceof Error ? error.message : "Failed to read learned patterns",
        });
      }
    },
  },
  {
    name: "exit",
    description: "Quit the application",
    value: "/exit",
    action: (ctx) => {
      ctx.exit();
    },

  },
];
