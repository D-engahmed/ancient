
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. 
// file: packages/cli/src/components/session-shell.tsx

import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { InputBar } from "./input-bar";
import { Spinner } from "./spinner";
import { usePromptConfig } from "../providers/prompt-config";

type Props = {
  children?: ReactNode;
  onSubmit: (text: string) => void;
  inputDisabled?: boolean;
  loading?: boolean;
  interruptible?: boolean;
  prefill?: { text: string; nonce: number } | null;
};

export function SessionShell({
  children,
  onSubmit,
  inputDisabled = false,
  loading = false,
  interruptible = false,
  prefill = null,
}: Props) {
  const { mode } = usePromptConfig();

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      height="100%"
      paddingY={1}
      paddingX={2}
      gap={1}
    >
      <scrollbox flexGrow={1} width="100%" stickyScroll stickyStart="bottom">
        <box>{children}</box>
      </scrollbox>
      <box flexShrink={0}>
        <InputBar onSubmit={onSubmit} disabled={inputDisabled} prefill={prefill} />
      </box>
      <box
        flexShrink={0}
        flexDirection="row"
        justifyContent="space-between"
        width="100%"
        height={1}
        gap={2}
        paddingLeft={1}
      >
        <box flexDirection="row" alignItems="center" gap={2}>
          {loading ? (
            <>
              <Spinner mode={mode} />
              {interruptible ? <text attributes={TextAttributes.DIM}>esc to interrupt</text> : null}
            </>
          ) : (
            <text attributes={TextAttributes.DIM}>ctrl+shift+y copy · ctrl+shift+r re-send</text>
          )}
        </box>

        <box flexDirection="row" gap={1} flexShrink={0} marginLeft="auto">
          {loading ? (
            <text attributes={TextAttributes.DIM}>setting up session…</text>
          ) : null}
        </box>
      </box>
    </box>
  );
};