// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 7/8 — Execution inspect dialog.
// Shows detailed metadata about the current or last execution:
// status, duration, token usage, and tool-call timeline.

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";
import type { ExecutionStatus } from "../../hooks/use-execution";
import type { TimelineEntry } from "../../lib/execution-stream";

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

type Props = {
  status: ExecutionStatus;
  durationMs?: number;
  usage?: Usage;
  timeline: TimelineEntry[];
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const remain = (s % 60).toFixed(0);
  return `${m}m ${remain}s`;
}

export function InspectDialogContent({ status, durationMs, usage, timeline }: Props) {
  const { colors } = useTheme();

  const statusLabel: Record<string, string> = {
    idle: "Idle",
    submitted: "Starting",
    streaming: "Running",
    ready: "Completed",
    error: "Failed",
  };

  return (
    <box flexDirection="column" gap={1} width="100%">
      {/* Status */}
      <box flexDirection="row" gap={1}>
        <text attributes={TextAttributes.DIM}>Status:</text>
        <text
          fg={
            status === "ready"
              ? colors.success
              : status === "error"
                ? colors.error
                : status === "streaming"
                  ? colors.primary
                  : colors.dimSeparator
          }
        >
          {statusLabel[status] ?? status}
        </text>
      </box>

      {/* Duration */}
      {durationMs !== undefined && (
        <box flexDirection="row" gap={1}>
          <text attributes={TextAttributes.DIM}>Duration:</text>
          <text>{formatDuration(durationMs)}</text>
        </box>
      )}

      {/* Usage */}
      {usage && (usage.inputTokens !== undefined || usage.outputTokens !== undefined) && (
        <box flexDirection="row" gap={1}>
          <text attributes={TextAttributes.DIM}>Tokens:</text>
          <text>
            {usage.inputTokens ?? "?"} in / {usage.outputTokens ?? "?"} out
            {usage.costUsd !== undefined ? ` ($${usage.costUsd.toFixed(4)})` : ""}
          </text>
        </box>
      )}

      {/* Timeline */}
      {timeline.length > 0 && (
        <box flexDirection="column" gap={0} paddingTop={1}>
          <text attributes={TextAttributes.DIM}>Tool calls ({timeline.length}):</text>
          {timeline.map((entry) => (
            <box key={entry.id} flexDirection="row" gap={1} paddingLeft={2}>
              <text
                fg={
                  entry.status === "done"
                    ? colors.success
                    : entry.status === "running"
                      ? colors.primary
                      : entry.status === "error"
                        ? colors.error
                        : colors.dimSeparator
                }
              >
                {entry.status === "done" ? "✓" : entry.status === "running" ? "●" : entry.status === "error" ? "✕" : "○"}
              </text>
              <text>{entry.label}</text>
            </box>
          ))}
        </box>
      )}

      {timeline.length === 0 && status === "idle" && (
        <text attributes={TextAttributes.DIM}>No execution data yet.</text>
      )}
    </box>
  );
}
