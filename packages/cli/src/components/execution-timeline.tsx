// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 6 — Execution timeline view.
// Shows structured tool-call timeline during execution.
// Replaces the old message-based rendering for the active execution.

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import type { TimelineEntry } from "../lib/execution-stream";

type Props = {
  entries: TimelineEntry[];
  text?: string;
};

function formatToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function statusSymbol(status: TimelineEntry["status"], colors: ReturnType<typeof useTheme>["colors"]): string {
  switch (status) {
    case "done":
      return colors.success;
    case "running":
      return colors.primary;
    case "error":
      return colors.error;
    case "pending":
    default:
      return colors.dimSeparator;
  }
}

export function ExecutionTimeline({ entries, text }: Props) {
  const { colors } = useTheme();

  if (entries.length === 0 && !text) return null;

  return (
    <box flexDirection="column" width="100%" gap={0}>
      {entries.length > 0 && (
        <box flexDirection="column" gap={0}>
          {entries.map((entry) => (
            <box key={entry.id} flexDirection="row" alignItems="center" gap={1} paddingLeft={2}>
              <text fg={statusSymbol(entry.status, colors)}>
                {entry.status === "done" ? "✓" : entry.status === "running" ? "●" : entry.status === "error" ? "✕" : "○"}
              </text>
              <text>
                <span attributes={TextAttributes.DIM}>{formatToolName(entry.label)}</span>
                {entry.status === "running" && (
                  <span attributes={TextAttributes.DIM}>...</span>
                )}
              </text>
            </box>
          ))}
        </box>
      )}
      {text && (
        <box paddingTop={entries.length > 0 ? 1 : 0} paddingLeft={2}>
          <text attributes={TextAttributes.DIM}>{text}</text>
        </box>
      )}
    </box>
  );
}