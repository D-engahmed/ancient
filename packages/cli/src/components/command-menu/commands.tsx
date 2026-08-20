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
    name: "exit",
    description: "Quit the application",
    value: "/exit",
    action: (ctx) => {
      ctx.exit();
    },

  },
];
