import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { DEFAULT_CHAT_MODEL_ID, type SupportedChatModelId } from "@ANCIENT/shared";
import { Mode } from "@ANCIENT/database/enums";

type PromptConfigContextValue = {
    mode: Mode;
    toggleMode: () => void;
    setMode: (mode: Mode) => void;
    model: SupportedChatModelId;
    setModel: (model: SupportedChatModelId) => void;
};

const PromptConfigContext = createContext<PromptConfigContextValue | null>(null);

export function usePromptConfig(): PromptConfigContextValue {
    const value = useContext(PromptConfigContext);
    if (!value) {
        throw new Error("usePromptConfig must be used within a PromptConfigProvider");
    }
    return value;
};

type PromptConfigProviderProps = {
    children: ReactNode;
};

export function PromptConfigProvider({ children }: PromptConfigProviderProps) {
    const [mode, setMode] = useState<Mode>(Mode.BUILD);
    const [model, setModel] = useState<SupportedChatModelId>(DEFAULT_CHAT_MODEL_ID);

    const toggleMode = useCallback(() => {
        setMode((m) => (m === Mode.BUILD ? Mode.PLAN : Mode.BUILD));
    }, []);

    return (
        <PromptConfigContext.Provider
            value={{
                mode,
                toggleMode,
                setMode,
                model,
                setModel
            }}>
            {children}
        </PromptConfigContext.Provider>
    );
};