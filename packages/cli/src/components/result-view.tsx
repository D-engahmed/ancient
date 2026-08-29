// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 10 — Artifact/result views.
// Renders tool call results in a type-aware way: diffs get syntax-highlighted
// SEARCH/REPLACE blocks, file listings get a compact tree, large outputs get
// truncated with a "(N more lines)" hint.

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";

type Props = {
  result: unknown;
  toolName?: string;
};

const MAX_LINES = 40;
const MAX_LINE_LEN = 200;

function truncate(text: string, maxLines: number): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { text, truncated: false };
  return {
    text: lines.slice(0, maxLines).join("\n"),
    truncated: true,
  };
}

function resultToString(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === null || result === undefined) return "";
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function isDiffOutput(text: string): boolean {
  return text.includes("<<<<<<< SEARCH") || text.includes("=======");
}

function DiffView({ text }: { text: string }) {
  const { colors } = useTheme();
  const { text: display, truncated } = truncate(text, MAX_LINES);
  const lines = display.split("\n");

  return (
    <box flexDirection="column" gap={0}>
      {lines.map((line, i) => {
        if (line.startsWith("<<<<<<< SEARCH")) {
          return <text key={i} fg={colors.error} attributes={TextAttributes.BOLD}>{"<<<<<<< SEARCH"}</text>;
        }
        if (line.startsWith("=======")) {
          return <text key={i} fg={colors.dimSeparator} attributes={TextAttributes.BOLD}>{"======="}</text>;
        }
        if (line.startsWith(">>>>>>> REPLACE")) {
          return <text key={i} fg={colors.success} attributes={TextAttributes.BOLD}>{">>>>>>> REPLACE"}</text>;
        }
        // Context lines: red for removed, green for added
        const prev = lines[i - 1] ?? "";
        if (prev.startsWith("=======")) {
          return <text key={i} fg={colors.success}>{"+ "}{line}</text>;
        }
        if (prev.startsWith("<<<<<<< SEARCH")) {
          return <text key={i} fg={colors.error}>{"- "}{line}</text>;
        }
        return <text key={i}>{"  "}{line}</text>;
      })}
      {truncated && (
        <text attributes={TextAttributes.DIM}>
          {"  ... "}{lines.length} more lines (showing first {MAX_LINES})
        </text>
      )}
    </box>
  );
}

function FileListView({ text }: { text: string }) {
  const { colors } = useTheme();
  const { text: display, truncated } = truncate(text, MAX_LINES);
  const lines = display.split("\n");

  return (
    <box flexDirection="column" gap={0}>
      {lines.map((line, i) => {
        // Highlight directories (lines ending with /)
        if (line.endsWith("/")) {
          return <text key={i} fg={colors.primary}>{line}</text>;
        }
        // Highlight files with extensions
        const ext = line.split(".").pop();
        if (ext && ext !== line) {
          return <text key={i}>{line}</text>;
        }
        return <text key={i} attributes={TextAttributes.DIM}>{line}</text>;
      })}
      {truncated && (
        <text attributes={TextAttributes.DIM}>
          {"... "}{lines.length} more entries (showing first {MAX_LINES})
        </text>
      )}
    </box>
  );
}

function CommandOutputView({ text }: { text: string }) {
  const { colors } = useTheme();
  const { text: display, truncated } = truncate(text, MAX_LINES);
  const lines = display.split("\n");

  return (
    <box flexDirection="column" gap={0}>
      {lines.map((line, i) => {
        // Highlight error patterns
        if (/error|fatal|panic|fail/i.test(line)) {
          return <text key={i} fg={colors.error}>{line}</text>;
        }
        // Highlight warning patterns
        if (/warn|deprecated/i.test(line)) {
          return <text key={i} fg={colors.planMode}>{line}</text>;
      }
        return <text key={i}>{line}</text>;
      })}
      {truncated && (
        <text attributes={TextAttributes.DIM}>
          {"... "}{lines.length} more lines (showing first {MAX_LINES})
        </text>
      )}
    </box>
  );
}

function DefaultResultView({ text }: { text: string }) {
  const { text: display, truncated } = truncate(text, MAX_LINES);
  return (
    <box flexDirection="column" gap={0}>
      <text>{display}</text>
      {truncated && (
        <text attributes={TextAttributes.DIM}>
          {"... output truncated (showing first {MAX_LINES} lines)"}
        </text>
      )}
    </box>
  );
}

function detectViewType(toolName: string | undefined, text: string): "diff" | "files" | "command" | "default" {
  if (isDiffOutput(text)) return "diff";
  if (toolName === "bash" || toolName === "shell") return "command";
  if (["listDirectory", "glob", "readDirectory"].includes(toolName ?? "")) return "files";
  return "default";
}

export function ResultView({ result, toolName }: Props) {
  const text = resultToString(result);
  if (!text.trim()) {
    return (
      <text attributes={TextAttributes.DIM}>(empty result)</text>
    );
  }

  const viewType = detectViewType(toolName, text);

  switch (viewType) {
    case "diff":
      return <DiffView text={text} />;
    case "files":
      return <FileListView text={text} />;
    case "command":
      return <CommandOutputView text={text} />;
    default:
      return <DefaultResultView text={text} />;
  }
}
