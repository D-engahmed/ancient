// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. 
// file: packages/cli/src/components/status-bar.tsx

import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";
import { Mode, SUPPORTED_CHAT_MODELS } from "@ANCIENT/shared";
import { useEffect, useState } from "react";
import { apiClient } from "../lib/api-client";

export function StatusBar() {
  const { mode, modelSelection } = usePromptConfig();
  const { colors } = useTheme();
  const [customLabel, setCustomLabel] = useState<string | null>(null);

  useEffect(() => {
    if (modelSelection.modelKind === "builtin") {
      setCustomLabel(null);
      return;
    }
    let ignore = false;
    const fetchLabel = async () => {
      try {
        const res = await apiClient.providerConnections[":id"].$get({
          param: { id: modelSelection.connectionId },
        });
        if (!res.ok) throw new Error();
        const conn = await res.json();
        if (!ignore) setCustomLabel(conn.label);
      } catch {
        if (!ignore) setCustomLabel(modelSelection.connectionId);
      }
    };
    fetchLabel();
    return () => { ignore = true; };
  }, [modelSelection]);

  let displayModel: string;
  if (modelSelection.modelKind === "builtin") {
    const found = SUPPORTED_CHAT_MODELS.find((m) => m.id === modelSelection.modelId);
    displayModel = found ? found.id : modelSelection.modelId;
  } else {
    displayModel = customLabel ?? modelSelection.connectionId;
  }

  return (
    <box flexDirection="row" gap={1}>
      <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>
        {mode === Mode.PLAN ? "Plan" : "Build"}
      </text>
      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
        ›
      </text>
      <text>{displayModel}</text>
    </box>
  );
}