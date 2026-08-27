
// Copyright (c) Microsoft Corporation. All rights reserved. 
// Licensed under the MIT License.
// file: packages/cli/src/screens/home.tsx

import { useCallback } from "react";
import { useNavigate } from "react-router";
import { Header } from "../components/header";
import { InputBar } from "../components/input-bar";
import { usePromptConfig } from "../providers/prompt-config";
import { TextAttributes } from "@opentui/core";

export function Home() {
  const navigate = useNavigate();
  const { mode, modelSelection } = usePromptConfig();

  const handleSubmit = useCallback(
    (text: string) => {
      navigate("/sessions/new", { state: { message: text, mode, model: modelSelection } });
    },
    [navigate, mode, modelSelection],
  );

  return (
    <box
      alignItems="center"
      justifyContent="center"
      flexGrow={1}
      gap={2}
      position="relative"
      width="100%"
      height="100%"
    >
      <Header />
      <box width="100%" maxWidth={78} paddingX={2} flexDirection="column" gap={1}>
        <InputBar onSubmit={handleSubmit} />
        <box flexDirection="row" gap={2} flexShrink={0} marginLeft="auto">
          <box flexDirection="row" gap={1}>
            <text>tab</text>
            <text attributes={TextAttributes.DIM}>mode</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text>/</text>
            <text attributes={TextAttributes.DIM}>commands</text>
          </box>
        </box>
      </box>
    </box>
  );
}