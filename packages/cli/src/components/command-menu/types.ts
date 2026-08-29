
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// file: packages/cli/src/components/command-menu/types.ts

import type { DialogContextValue } from "../../providers/dialog";
import type { ToastContextValue } from "../../providers/toast";
import type { ModeType, SupportedChatModelId } from "@ANCIENT/shared";
import type { ExecutionStatus } from "../../hooks/use-execution";

export type CommandContext = {
  exit: () => void;
  toast: ToastContextValue;
  dialog: DialogContextValue;
  navigate: (path: string) => void;
  mode: ModeType;
  setMode: (mode: ModeType) => void;
  setModel: (model: SupportedChatModelId) => void;
  /** Active session id when the palette is opened inside a session route. */
  sessionId?: string;
  /** The directory the CLI was launched in (workspace for skills/agents/MCP). */
  cwd?: string;
  /** Cancel the active execution (POST /executions/:id/cancel). */
  interrupt?: () => void;
  /** Current execution status (idle/submitted/streaming/ready/error). */
  executionStatus?: ExecutionStatus;
};

export type Command = {
  name: string;
  description: string;
  value: string;
  action?: (ctx: CommandContext) => void | Promise<void>;
};
