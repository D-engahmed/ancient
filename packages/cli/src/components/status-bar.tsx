// status-bar.tsx
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
  const [customModelId, setCustomModelId] = useState<string | null>(null);

  useEffect(() => {
    if (modelSelection.modelKind === "builtin") {
      setCustomLabel(null);
      setCustomModelId(null);
      return;
    }

    let ignore = false;
    const fetchDetails = async () => {
      try {
        const conn = await apiClient.providerConnections.get(modelSelection.connectionId);
        if (!ignore) {
          setCustomLabel(conn.label);
          setCustomModelId(conn.modelId);
        }
      } catch {
        if (!ignore) {
          setCustomLabel(null);
          setCustomModelId(null);
        }
      }
    };
    fetchDetails();
    return () => { ignore = true; };
  }, [modelSelection]);

  let displayModel: string;
  if (modelSelection.modelKind === "builtin") {
    const found = SUPPORTED_CHAT_MODELS.find((m) => m.id === modelSelection.modelId);
    displayModel = found ? found.id : modelSelection.modelId;
  } else {
    if (customLabel) displayModel = customLabel;
    else if (customModelId) displayModel = `Custom (${customModelId})`;
    else displayModel = modelSelection.connectionId.slice(0, 8);
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