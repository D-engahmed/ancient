// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 6 — Execution footer bar.
// Shows mode + model + cost + duration + TAB hint.
// Replaces the old help/status line in session mode.

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";
import { Mode, type ModeType, type ChatModelSelection, SUPPORTED_CHAT_MODELS } from "@ANCIENT/shared";
import type { ExecutionStatus } from "../hooks/use-execution";

type Props = {
  status: ExecutionStatus;
  durationMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function modelDisplayName(model: ChatModelSelection): string {
  if (model.modelKind === "builtin") {
    const found = SUPPORTED_CHAT_MODELS.find((m) => m.id === model.modelId);
    return found?.id ?? model.modelId;
  }
  return "custom";
}

function formatCost(usage: Props["usage"]): string {
  if (usage?.costUsd != null) {
    return `$${usage.costUsd.toFixed(3)}`;
  }
  return "Cost unavailable";
}

function formatTokens(usage: Props["usage"]): string {
  if (usage == null) return "";
  const parts: string[] = [];
  if (usage.inputTokens != null) parts.push(`${usage.inputTokens} in`);
  if (usage.outputTokens != null) parts.push(`${usage.outputTokens} out`);
  return parts.join(" / ");
}

export function ExecutionFooter({ status, durationMs, usage }: Props) {
  const { colors } = useTheme();
  const { mode, modelSelection } = usePromptConfig();
  const isActive = status === "submitted" || status === "streaming";
  const duration = durationMs != null ? formatDuration(durationMs) : null;
  const tokenStr = formatTokens(usage);

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      width="100%"
      paddingLeft={2}
      paddingRight={2}
      height={1}
    >
      <box flexDirection="row" alignItems="center" gap={1}>
        <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>
          {mode === Mode.PLAN ? "PLAN" : "BUILD"}
        </text>
        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>│</text>
        <text attributes={TextAttributes.DIM}>{modelDisplayName(modelSelection)}</text>
        {duration && (
          <>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>│</text>
            <text attributes={TextAttributes.DIM}>{duration}</text>
          </>
        )}
        {tokenStr && (
          <>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>│</text>
            <text attributes={TextAttributes.DIM}>{tokenStr}</text>
          </>
        )}
        {(status === "ready" || status === "error") && usage?.costUsd != null && (
          <>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>│</text>
            <text attributes={TextAttributes.DIM}>{formatCost(usage)}</text>
          </>
        )}
      </box>
      <box flexDirection="row" alignItems="center" gap={1}>
        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>TAB</text>
        <text attributes={TextAttributes.DIM}>inspect</text>
      </box>
    </box>
  );
}