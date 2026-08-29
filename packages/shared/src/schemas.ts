// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { z } from "zod";
import { tool } from "ai";
import { findSupportedChatModel } from "./models";

export const Mode = { BUILD: "BUILD", PLAN: "PLAN" } as const;
export const modeSchema = z.enum([Mode.BUILD, Mode.PLAN]);
export type ModeType = (typeof Mode)[keyof typeof Mode];

// FIXED: z.discriminatedUnion removed in Zod v4
export const chatModelSelectionSchema = z.union([
  z.object({ modelKind: z.literal("builtin"), modelId: z.string().refine(findSupportedChatModel) }),
  z.object({ modelKind: z.literal("custom"), connectionId: z.string().uuid() }),
]);
export type ChatModelSelection = z.infer<typeof chatModelSelectionSchema>;

// FIXED: use modeSchema instead of z.enum(Mode)
export const submitSchema = z.object({
  content: z.string(),
  mode: modeSchema,
  model: chatModelSelectionSchema,
});

export const toolInputSchemas = {
  readFile: z.object({ path: z.string() }),
  listDirectory: z.object({ path: z.string().default(".") }),
  glob: z.object({ pattern: z.string(), path: z.string().default(".") }),
  grep: z.object({ pattern: z.string(), path: z.string().default("."), include: z.string().optional() }),
  writeFile: z.object({ path: z.string(), content: z.string() }),
  editFile: z.object({ path: z.string(), oldString: z.string(), newString: z.string() }),
  bash: z.object({ command: z.string(), description: z.string().optional(), timeout: z.number().optional() }),
  listSkills: z.object({}),
  useSkill: z.object({ name: z.string() }),
} as const;

export const readOnlyToolContracts = {
  readFile: tool({ description: "Read a file", inputSchema: toolInputSchemas.readFile }),
  listDirectory: tool({ description: "List directory", inputSchema: toolInputSchemas.listDirectory }),
  glob: tool({ description: "Glob", inputSchema: toolInputSchemas.glob }),
  grep: tool({ description: "Grep", inputSchema: toolInputSchemas.grep }),
} as const;

export const buildToolContracts = {
  ...readOnlyToolContracts,
  writeFile: tool({ description: "Write file", inputSchema: toolInputSchemas.writeFile }),
  editFile: tool({ description: "Edit file", inputSchema: toolInputSchemas.editFile }),
  bash: tool({ description: "Run bash", inputSchema: toolInputSchemas.bash }),
} as const;

export type ToolContracts = typeof buildToolContracts;
export function getToolContracts(mode: ModeType) {
  return mode === Mode.PLAN ? readOnlyToolContracts : buildToolContracts;
}

// FIXED: z.json() does not exist
export const toolCallArgsSchema = z.record(z.string(), z.unknown());

export const messagePartSchema = z.union([
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({ type: z.literal("tool-call"), id: z.string(), name: z.string(), args: toolCallArgsSchema, result: z.string().optional() }),
  z.object({ type: z.literal("text"), text: z.string() }),
]);

export const messagePartsSchema = z.array(messagePartSchema);
export type MessagePart = z.infer<typeof messagePartSchema>;

export const chatStreamEventSchema = z.union([
  z.object({ type: z.literal("text-delta"), text: z.string() }),
  z.object({ type: z.literal("reasoning-delta"), text: z.string() }),
  z.object({ type: z.literal("tool-call"), toolCallId: z.string(), toolName: z.string(), args: toolCallArgsSchema }),
  z.object({ type: z.literal("tool-result"), toolCallId: z.string(), result: z.string() }),
  z.object({ type: z.literal("done"), messageId: z.string(), durationMs: z.number() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;