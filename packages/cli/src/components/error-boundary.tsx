// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// CLI-V2 Phase 11 — Error boundary.
// Catches component crashes and renders a recovery UI instead of
// bringing down the entire terminal session. Users can press Enter
// to reset or Esc to quit.

import { Component, type ReactNode } from "react";
import { TextAttributes } from "@opentui/core";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log for diagnostics; in production this could send to an error tracker.
    console.error("[ErrorBoundary]", error.message, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <box flexDirection="column" gap={1} padding={2}>
          <text>
            <text attributes={TextAttributes.BOLD}>Something went wrong.</text>
          </text>
          <text>{this.state.error.message}</text>
          <text>
            Press <text attributes={TextAttributes.BOLD}>Enter</text> to restart or{" "}
            <text attributes={TextAttributes.BOLD}>Esc</text> to quit.
          </text>
        </box>
      );
    }
    return this.props.children;
  }
}
