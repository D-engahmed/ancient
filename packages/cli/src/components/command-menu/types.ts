import type { Mode } from "@ANCIENT/database/enums";
import type { DialogContextValue } from "../../providers/dialog";
import type { ToastContextValue } from "../../providers/toast";
import type { SupportedChatModelId } from "@ANCIENT/shared";

export type CommandContext = {
    exit: () => void;
    toast: ToastContextValue;
    dialog: DialogContextValue;
    navigate: (path: string) => void;
    mode: Mode;
    setMode: (mode: Mode) => void;
    setModel: (model: SupportedChatModelId) => void;
};

export type Command = {
    name: string;
    description: string;
    value: string;
    action?: (ctx: CommandContext) => void | Promise<void>;
};