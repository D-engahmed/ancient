// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. 
// file: packages/cli/src/layouts/themed-root.tsx
import type { ReactNode } from "react";
import { useTheme } from "../providers/theme";

type Props = {
  children: ReactNode;
};

export function ThemedRoot({ children }: Props) {
  const { colors } = useTheme();

  return (
    <box
      backgroundColor={colors.background}
      width="100%"
      height="100%"
      flexGrow={1}
    >
      {children}
    </box>
  );
};
