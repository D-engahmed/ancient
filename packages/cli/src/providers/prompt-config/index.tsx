// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. 
// file: packages/cli/src/providers/prompt-config/index.tsx

import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_CHAT_MODEL_ID,
  Mode,
  type ModeType,
  type ChatModelSelection,
  type SupportedChatModelId,
} from "@ANCIENT/shared";

type PromptConfigContextValue = {
  mode: ModeType;
  toggleMode: () => void;
  setMode: (mode: ModeType) => void;
  modelSelection: ChatModelSelection;
  setModelSelection: (selection: ChatModelSelection) => void;
  setBuiltinModel: (id: SupportedChatModelId) => void;
  setModel: (id: SupportedChatModelId) => void;
};

const PromptConfigContext = createContext<PromptConfigContextValue | null>(null);

export function usePromptConfig(): PromptConfigContextValue {
  const value = useContext(PromptConfigContext);
  if (!value) {
    throw new Error("usePromptConfig must be used within a PromptConfigProvider");
  }
  return value;
}

type PromptConfigProviderProps = {
  children: ReactNode;
};

export function PromptConfigProvider({ children }: PromptConfigProviderProps) {
  const [mode, setMode] = useState<ModeType>(Mode.BUILD);
  const [modelSelection, setModelSelection] = useState<ChatModelSelection>({
    modelKind: "builtin",
    modelId: DEFAULT_CHAT_MODEL_ID,
  });

  const toggleMode = useCallback(() => {
    setMode((m) => (m === Mode.BUILD ? Mode.PLAN : Mode.BUILD));
  }, []);

  const setBuiltinModel = useCallback((modelId: SupportedChatModelId) => {
    setModelSelection({ modelKind: "builtin", modelId });
  }, []);

  const setModel = useCallback((modelId: SupportedChatModelId) => {
    setModelSelection({ modelKind: "builtin", modelId });
  }, []);

  return (
    <PromptConfigContext.Provider
      value={{
        mode,
        toggleMode,
        setMode,
        modelSelection,
        setModelSelection,
        setBuiltinModel,
        setModel,
      }}
    >
      {children}
    </PromptConfigContext.Provider>
  );
}