
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// file: packages/cli/src/providers/toast/types.ts

export type ToastVariant = "success" | "error" | "info";

export type ToastOptions = {
  message: string;
  variant?: ToastVariant;
  duration?: number;
};

export const DEFAULT_DURATION = 3000;
