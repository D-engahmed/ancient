import { TextAttributes } from "@opentui/core";

export function StatusBar() {
    return (
        <box flexDirection="row" gap={1}>
            <text fg="cyan">Build</text>
            <text attributes={TextAttributes.DIM} fg="gray">
                ›
            </text>
            <text>ATHLLM-1-1-2</text>
        </box>
    );
}