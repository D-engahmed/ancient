// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. 
// file: packages/cli/src/components/dev/render-guard.tsx

import { Component, type ReactNode } from "react";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LOG_PATH = join(homedir(), ".ANCIENT", "crash.log");

type Props = {
    children: ReactNode;
    label: string;
};

type State = {
    error: Error | null;
};

export class RenderGuard extends Component<Props, State> {
    // FIXED: tsconfig.base.json sets noImplicitOverride, so members that
    // override a React.Component base member need the explicit keyword.
    override state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    override componentDidCatch(error: Error, info: { componentStack?: string }) {
        try {
            appendFileSync(
                LOG_PATH,
                `\n[${new Date().toISOString()}] guard="${this.props.label}"\n` +
                `message: ${error.message}\n` +
                `stack:\n${error.stack}\n` +
                `componentStack:\n${info.componentStack ?? "(none provided by reconciler)"}\n` +
                `${"-".repeat(60)}\n`,
            );
        } catch {
            // last resort — if we can't even log, don't crash the crash handler
        }
    }

    override render() {
        if (this.state.error) {
            return <text fg="red">[{this.props.label}] {this.state.error.message}</text>;
        }
        return this.props.children;
    }
}