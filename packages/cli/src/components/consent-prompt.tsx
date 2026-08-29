// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 9 — Consent prompt banner.
// Shown when the engine requests approval for a tool call. Displays the
// capability name, reason, and approve/deny buttons (y/n keyboard shortcuts).

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import { useKeyboard } from "@opentui/react";
import { useKeyboardLayer } from "../providers/Keyboard-layer";

type Props = {
  capability: string;
  prompt?: string;
  onApprove: () => void;
  onDeny: () => void;
};

export function ConsentPrompt({ capability, prompt, onApprove, onDeny }: Props) {
  const { colors } = useTheme();
  const { isTopLayer, push, pop } = useKeyboardLayer();

  // y = approve, n = deny, Escape = deny
  useKeyboard((key) => {
    if (!isTopLayer("consent")) return;
    if (key.name === "y" || key.name === "return") {
      key.preventDefault();
      pop("consent");
      onApprove();
    } else if (key.name === "n" || key.name === "escape") {
      key.preventDefault();
      pop("consent");
      onDeny();
    }
  });

  // Push consent layer so keyboard shortcuts don't conflict.
  push("consent", () => {
    pop("consent");
    onDeny();
    return true;
  });

  return (
    <box
      flexDirection="column"
      gap={0}
      paddingX={2}
      paddingY={1}
      borderStyle="single"
      borderColor={colors.planMode}
      width="100%"
    >
      <box flexDirection="row" gap={1}>
        <text fg={colors.planMode} attributes={TextAttributes.BOLD}>
          Approval Required
        </text>
      </box>
      <box flexDirection="row" gap={1} paddingTop={0}>
        <text>
          <text attributes={TextAttributes.DIM}>Tool: </text>
          <text>{capability}</text>
        </text>
      </box>
      {prompt && (
        <box flexDirection="row" gap={1} paddingTop={0}>
          <text>
            <text attributes={TextAttributes.DIM}>Reason: </text>
            <text>{prompt}</text>
          </text>
        </box>
      )}
      <box flexDirection="row" gap={2} paddingTop={1}>
        <text>
          <text fg={colors.success} attributes={TextAttributes.BOLD}>y</text>
          <text attributes={TextAttributes.DIM}> approve</text>
        </text>
        <text>
          <text fg={colors.error} attributes={TextAttributes.BOLD}>n</text>
          <text attributes={TextAttributes.DIM}> deny</text>
        </text>
      </box>
    </box>
  );
}
