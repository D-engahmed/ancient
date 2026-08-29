// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 8 — Execution inspector panel.
// Shows detailed information about a selected timeline entry (tool call):
// capability name, arguments, result or error, and status.
// Displayed when the user presses TAB during execution.

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import type { TimelineEntry } from "../lib/execution-stream";

type Props = {
  entry: TimelineEntry | null;
};

function formatValue(value: unknown, maxLen = 200): string {
  if (value === undefined) return "(undefined)";
  if (value === null) return "(null)";
  if (typeof value === "string") {
    return value.length > maxLen ? value.slice(0, maxLen) + "…" : value;
  }
  try {
    const json = JSON.stringify(value, null, 2);
    return json.length > maxLen ? json.slice(0, maxLen) + "…" : json;
  } catch {
    return String(value);
  }
}

export function ExecutionInspector({ entry }: Props) {
  const { colors } = useTheme();

  if (!entry) {
    return (
      <box flexDirection="column" gap={1} paddingX={2} paddingTop={1}>
        <text attributes={TextAttributes.DIM}>No tool call selected.</text>
      </box>
    );
  }

  const statusLabel =
    entry.status === "done" ? "Completed" :
    entry.status === "running" ? "Running" :
    entry.status === "error" ? "Failed" : "Pending";

  const statusColor =
    entry.status === "done" ? colors.success :
    entry.status === "running" ? colors.primary :
    entry.status === "error" ? colors.error : colors.dimSeparator;

  // Filter out internal keys from args display
  const displayArgs = Object.fromEntries(
    Object.entries(entry.args ?? {}).filter(([k]) => !k.startsWith("__"))
  );

  return (
    <box flexDirection="column" gap={1} paddingX={2} paddingTop={1}>
      {/* Header */}
      <box flexDirection="row" gap={1}>
        <text attributes={TextAttributes.DIM}>Inspector:</text>
        <text>{entry.label}</text>
        <text fg={statusColor}>({statusLabel})</text>
      </box>

      {/* Arguments */}
      {Object.keys(displayArgs).length > 0 && (
        <box flexDirection="column" gap={0}>
          <text attributes={TextAttributes.DIM}>Arguments:</text>
          <box paddingLeft={2}>
            <text>{formatValue(displayArgs, 300)}</text>
          </box>
        </box>
      )}

      {/* Result */}
      {entry.result !== undefined && (
        <box flexDirection="column" gap={0}>
          <text attributes={TextAttributes.DIM}>Result:</text>
          <box paddingLeft={2}>
            <text fg={colors.success}>{formatValue(entry.result, 300)}</text>
          </box>
        </box>
      )}

      {/* Error */}
      {entry.error !== undefined && (
        <box flexDirection="column" gap={0}>
          <text attributes={TextAttributes.DIM}>Error:</text>
          <box paddingLeft={2}>
            <text fg={colors.error}>{formatValue(entry.error, 300)}</text>
          </box>
        </box>
      )}
    </box>
  );
}
