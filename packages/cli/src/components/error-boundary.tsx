// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 11 — Error boundary.
// Catches component crashes and renders a recovery UI instead of
// bringing down the entire terminal session. Users can press Enter
// to reset or Esc to quit.

import { Component, type ReactNode } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  error: Error | null;
};

export function RecoveryFallback({ onReset }: { onReset: () => void }) {
  const { colors } = useTheme();
  const renderer = useRenderer();

  useKeyboard((key) => {
    if (key.name === "return" || key.name === "enter") {
      key.preventDefault();
      onReset();
    } else if (key.name === "escape") {
      key.preventDefault();
      renderer.destroy();
    }
  });

  return (
    <box flexDirection="column" gap={1} padding={2}>
      <text fg={colors.error} attributes={TextAttributes.BOLD}>Something went wrong.</text>
      <text>{`The UI hit an unexpected error. Press Enter to restart the app, or Esc to quit.`}</text>
    </box>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log for diagnostics; in production this could send to an error tracker.
    console.error("[ErrorBoundary]", error.message, info.componentStack);
  }

  reset() {
    this.setState({ error: null });
  }

  override render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return <RecoveryFallback onReset={() => this.reset()} />;
    }
    return this.props.children;
  }
}