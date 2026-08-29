// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// file: packages/cli/src/components/messages/bot-message.tsx

import prettyMs from "pretty-ms";
import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";
import type { Message } from "../../hooks/use-execution";
import { Mode, type ModeType } from "@ANCIENT/shared";
import { TextAttributes } from "@opentui/core";

type ClientMessagePart = Message["parts"][number];

type Props = {
  parts: ClientMessagePart[];
  model: string;
  mode: ModeType;
  durationMs?: number;
  streaming?: boolean;
};

type ToolPart = Extract<ClientMessagePart, { type: "tool" }>;

function isToolPart(part: ClientMessagePart): part is ToolPart {
  return part?.type === "tool";
}

// The server's persisted session history predates the wire contract; its tool
// parts may arrive in the legacy AI-SDK shape (toolCallId/toolName/input).
// Read both spellings so old transcripts still render. Kept deliberately lax.
function toolIdentity(part: ToolPart): { callId: string; name: string; args: Record<string, unknown> } {
  const legacy = part as unknown as {
    toolCallId?: string;
    toolName?: string;
    tool?: string;
    name?: string;
    input?: unknown;
  };
  const rawArgs = (part.args ?? legacy.input ?? {}) as Record<string, unknown>;
  return {
    callId: part.callId ?? legacy.toolCallId ?? "?",
    name: part.name ?? legacy.toolName ?? legacy.tool ?? "tool",
    args: rawArgs,
  };
}

function toolIsDone(part: ToolPart): boolean {
  const state = String(part.state ?? "");
  return (
    state === "ok" ||
    state === "error" ||
    state.endsWith("available") ||
    state.endsWith("error") ||
    state.endsWith("denied")
  );
}

function formatToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatToolArgs(args: Record<string, unknown>): string {
  if (args == null) return "";
  if (typeof args !== "object") return String(args);
  return Object.values(args).map(String).join(" ");
}

type PartGroup = {
  type: ClientMessagePart["type"];
  parts: ClientMessagePart[];
  key: string;
};

function groupConsecutiveParts(parts: ClientMessagePart[]): PartGroup[] {
  const groups: PartGroup[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const lastGroup = groups[groups.length - 1];

    if (lastGroup && lastGroup.type === part.type) {
      lastGroup.parts.push(part);
    } else {
      const key = isToolPart(part) ? `group-tc-${toolIdentity(part).callId}` : `group-${part.type}-${i}`;
      groups.push({ type: part.type, parts: [part], key });
    }
  }

  return groups;
}

export function BotMessage({
  parts,
  model,
  mode,
  durationMs,
  streaming = false,
}: Props) {
  const { colors } = useTheme();
  const safeParts = Array.isArray(parts) ? parts : [];
  return (
    <box width="100%" alignItems="center">
      {groupConsecutiveParts(parts).map((group, i) => (
        <box key={group.key} width="100%" paddingTop={i === 0 ? 0 : 1}>
          {group.parts.map((part, j) => {
            // Tolerant read: persisted session history may carry legacy AI-SDK
            // parts (reasoning/tool-input/…) outside the closed wire union.
            // The strict new-model parts (text/tool) are a subset of this view.
            const legacy = part as unknown as {
              type?: string;
              text?: string;
              input?: unknown;
            };

            if (legacy.type === "reasoning") {
              return (
                <box
                  key={`reasoning-${j}`}
                  border={["left"]}
                  borderColor={colors.thinkingBorder}
                  customBorderChars={{
                    ...EmptyBorder,
                    vertical: "│",
                  }}
                  width="100%"
                  paddingX={2}
                >
                  <text attributes={TextAttributes.DIM}>
                    <em fg={colors.thinking}>Thinking:</em> {legacy.text ?? ""}
                  </text>
                </box>
              );
            }

            if (isToolPart(part)) {
              const { callId, name, args } = toolIdentity(part);
              const isDone = toolIsDone(part);
              return (
                <box
                  key={callId}
                  border={["left"]}
                  borderColor={colors.thinkingBorder}
                  customBorderChars={{
                    ...EmptyBorder,
                    vertical: "│",
                  }}
                  width="100%"
                  paddingX={2}
                >
                  <text attributes={TextAttributes.DIM}>
                    <em fg={colors.info}>{formatToolName(name)}:</em>{" "}
                    {formatToolArgs(args)}
                    {isDone ? "" : " …"}
                  </text>
                </box>
              );
            }

            if (part.type === "text") {
              return (
                <box key={`text-${j}`} paddingX={3} width="100%">
                  <text>{part.text}</text>
                </box>
              );
            }

            return null;
          })}
        </box>
      ))}

      <box paddingX={3} paddingY={1} gap={1} width="100%">
        <box flexDirection="row" gap={2}>
          <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>◉</text>
          <box flexDirection="row" gap={1}>
            <text>
              {mode === Mode.PLAN ? "Plan" : "Build"}
            </text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              ›
            </text>
            <text attributes={TextAttributes.DIM}>{model}</text>
            {(durationMs != null) && (
              <>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                  ›
                </text>
                <text attributes={TextAttributes.DIM}>
                  {prettyMs(durationMs)}
                </text>
              </>
            )}
          </box>
        </box>
      </box>
    </box>
  );
}