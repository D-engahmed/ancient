// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 6 — Execution header bar.
// Shows ANCIENT branding + execution status indicator + live duration.
// Replaces the old ASCII-art Header in session mode.

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import type { ExecutionStatus } from "../hooks/use-execution";

type Props = {
  status: ExecutionStatus;
  durationMs?: number;
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function statusIndicator(status: ExecutionStatus, colors: ReturnType<typeof useTheme>["colors"]): {
  symbol: string;
  label: string;
  color: string;
} {
  switch (status) {
    case "submitted":
      return { symbol: "●", label: "STARTING", color: colors.info };
    case "streaming":
      return { symbol: "●", label: "EXECUTING", color: colors.primary };
    case "ready":
      return { symbol: "✓", label: "COMPLETED", color: colors.success };
    case "error":
      return { symbol: "✕", label: "FAILED", color: colors.error };
    case "idle":
    default:
      return { symbol: "", label: "", color: colors.dimSeparator };
  }
}

export function ExecutionHeader({ status, durationMs }: Props) {
  const { colors } = useTheme();
  const indicator = statusIndicator(status, colors);
  const showDuration = status === "streaming" || status === "ready" || status === "error";
  const duration = durationMs != null ? formatDuration(durationMs) : null;

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
      <text>
        <text attributes={TextAttributes.BOLD}>ANCIENT</text>
      </text>
      <box flexDirection="row" alignItems="center" gap={2}>
        {indicator.label && (
          <text>
            <text fg={indicator.color}>{indicator.symbol}</text>{" "}
            <text attributes={TextAttributes.DIM} fg={indicator.color}>{indicator.label}</text>
          </text>
        )}
        {showDuration && duration && (
          <text attributes={TextAttributes.DIM}>{duration}</text>
        )}
      </box>
    </box>
  );
}