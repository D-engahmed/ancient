// copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. 
// file: packages/cli/src/components/header.tsx
import { TextAttributes } from "@opentui/core";

export function Header() {
  return (
    <box justifyContent="center" alignItems="center" flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="center" gap={0.5} alignItems="center">
        <ascii-font font="tiny" text="ANCIENT " color="#959b8f" />
        <ascii-font font="tiny" text="Coder" color="#7eb0aa" />
      </box>
      <text attributes={TextAttributes.DIM} fg="#5b5f66">
        a lightweight coding agent for your repository
      </text>
    </box>
  );
};
