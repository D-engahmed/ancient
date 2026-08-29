// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 8/10 — Execution inspector panel.
// Shows detailed information about a selected timeline entry (tool call):
// capability name, arguments, rendered result (with type-aware views), and errors.
// Displayed when the user presses TAB during execution.

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import type { TimelineEntry } from "../lib/execution-stream";
import { ResultView } from "./result-view";

type Props = {
  entry: TimelineEntry | null;
};

function formatArgs(args: Record<string, unknown>): string {
  // Filter out internal keys
  const filtered = Object.fromEntries(
    Object.entries(args).filter(([k]) => !k.startsWith("__"))
  );
  if (Object.keys(filtered).length === 0) return "";
  try {
    const json = JSON.stringify(filtered, null, 2);
    return json.length > 400 ? json.slice(0, 400) + "…" : json;
  } catch {
    return String(filtered);
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

  const argsStr = formatArgs(entry.args ?? {});

  return (
    <box flexDirection="column" gap={1} paddingX={2} paddingTop={1}>
      {/* Header */}
      <box flexDirection="row" gap={1}>
        <text attributes={TextAttributes.DIM}>Inspector:</text>
        <text>{entry.label}</text>
        <text fg={statusColor}>({statusLabel})</text>
      </box>

      {/* Arguments */}
      {argsStr && (
        <box flexDirection="column" gap={0}>
          <text attributes={TextAttributes.DIM}>Arguments:</text>
          <box paddingLeft={2}>
            <text>{argsStr}</text>
          </box>
        </box>
      )}

      {/* Result — type-aware rendering */}
      {entry.result !== undefined && (
        <box flexDirection="column" gap={0}>
          <text attributes={TextAttributes.DIM}>Result:</text>
          <box paddingLeft={2}>
            <ResultView result={entry.result} toolName={entry.label} />
          </box>
        </box>
      )}

      {/* Error */}
      {entry.error !== undefined && (
        <box flexDirection="column" gap={0}>
          <text attributes={TextAttributes.DIM}>Error:</text>
          <box paddingLeft={2}>
            <text fg={colors.error}>
              {typeof entry.error === "string"
                ? entry.error
                : typeof entry.error === "object" && entry.error !== null
                  ? JSON.stringify(entry.error)
                  : String(entry.error)}
            </text>
          </box>
        </box>
      )}
    </box>
  );
}
