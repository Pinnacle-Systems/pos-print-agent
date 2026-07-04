import { z } from "zod";

// Kept in sync with the discriminated union below - used by print-job.service.ts
// to distinguish "unknown instruction type" (INSTRUCTION_TYPE_NOT_IMPLEMENTED)
// from "known type, malformed fields" (INVALID_PRINT_PAYLOAD) before the
// stricter per-type schemas below ever run.
export const KNOWN_INSTRUCTION_TYPES = ["text", "line", "feed", "cut", "leftRight", "blank", "openDrawer"] as const;
export type KnownInstructionType = (typeof KNOWN_INSTRUCTION_TYPES)[number];

const MAX_TEXT_VALUE_LENGTH = 500;
const MAX_LEFT_RIGHT_LEFT_LENGTH = 250;
const MAX_LEFT_RIGHT_RIGHT_LENGTH = 100;
export const MAX_INSTRUCTION_COUNT = 500;

export const TextAlignSchema = z.enum(["left", "center", "right"]);
export const TextSizeSchema = z.enum(["normal", "double-width", "double-height", "double"]);
export const CutModeSchema = z.enum(["full", "partial"]);

export const TextInstructionSchema = z.object({
  type: z.literal("text"),
  value: z.string().max(MAX_TEXT_VALUE_LENGTH, `text value must be at most ${MAX_TEXT_VALUE_LENGTH} characters`),
  align: TextAlignSchema.default("left"),
  bold: z.boolean().default(false),
  underline: z.boolean().default(false),
  size: TextSizeSchema.default("normal"),
});

export const LineInstructionSchema = z.object({
  type: z.literal("line"),
  char: z
    .string()
    .regex(/^[\x21-\x7E]$/, "line char must be a single printable character")
    .default("-"),
});

export const FeedInstructionSchema = z.object({
  type: z.literal("feed"),
  lines: z.number().int().min(1, "feed lines must be between 1 and 10").max(10, "feed lines must be between 1 and 10"),
});

export const CutInstructionSchema = z.object({
  type: z.literal("cut"),
  mode: CutModeSchema.default("full"),
});

export const LeftRightInstructionSchema = z.object({
  type: z.literal("leftRight"),
  left: z.string().min(1, "left is required").max(MAX_LEFT_RIGHT_LEFT_LENGTH, `left must be at most ${MAX_LEFT_RIGHT_LEFT_LENGTH} characters`),
  right: z.string().min(1, "right is required").max(MAX_LEFT_RIGHT_RIGHT_LENGTH, `right must be at most ${MAX_LEFT_RIGHT_RIGHT_LENGTH} characters`),
  bold: z.boolean().default(false),
  underline: z.boolean().default(false),
  size: TextSizeSchema.default("normal"),
});

export const BlankInstructionSchema = z.object({
  type: z.literal("blank"),
  lines: z.number().int().min(1, "blank lines must be between 1 and 5").max(5, "blank lines must be between 1 and 5").default(1),
});

export const OpenDrawerInstructionSchema = z.object({
  type: z.literal("openDrawer"),
});

export const PrintInstructionSchema = z.discriminatedUnion("type", [
  TextInstructionSchema,
  LineInstructionSchema,
  FeedInstructionSchema,
  CutInstructionSchema,
  LeftRightInstructionSchema,
  BlankInstructionSchema,
  OpenDrawerInstructionSchema,
]);

export const PrintInstructionsPayloadSchema = z.object({
  width: z
    .number()
    .int()
    .min(32, "payload.width must be between 32 and 48")
    .max(48, "payload.width must be between 32 and 48")
    .default(42),
  instructions: z
    .array(PrintInstructionSchema)
    .min(1, "payload.instructions must be a non-empty array")
    .max(MAX_INSTRUCTION_COUNT, `payload.instructions must not exceed ${MAX_INSTRUCTION_COUNT} items`),
});

export type TextInstruction = z.infer<typeof TextInstructionSchema>;
export type LineInstruction = z.infer<typeof LineInstructionSchema>;
export type FeedInstruction = z.infer<typeof FeedInstructionSchema>;
export type CutInstruction = z.infer<typeof CutInstructionSchema>;
export type LeftRightInstruction = z.infer<typeof LeftRightInstructionSchema>;
export type BlankInstruction = z.infer<typeof BlankInstructionSchema>;
export type OpenDrawerInstruction = z.infer<typeof OpenDrawerInstructionSchema>;
export type PrintInstruction = z.infer<typeof PrintInstructionSchema>;
export type PrintInstructionsPayload = z.infer<typeof PrintInstructionsPayloadSchema>;
