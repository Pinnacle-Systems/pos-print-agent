import { z } from "zod";

// Kept in sync with the discriminated union below - used by print-job.service.ts
// to distinguish "unknown instruction type" (INSTRUCTION_TYPE_NOT_IMPLEMENTED)
// from "known type, malformed fields" (INVALID_PRINT_PAYLOAD) before the
// stricter per-type schemas below ever run.
export const KNOWN_INSTRUCTION_TYPES = ["text", "line", "feed", "cut"] as const;
export type KnownInstructionType = (typeof KNOWN_INSTRUCTION_TYPES)[number];

const MAX_TEXT_VALUE_LENGTH = 500;
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

export const PrintInstructionSchema = z.discriminatedUnion("type", [
  TextInstructionSchema,
  LineInstructionSchema,
  FeedInstructionSchema,
  CutInstructionSchema,
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
export type PrintInstruction = z.infer<typeof PrintInstructionSchema>;
export type PrintInstructionsPayload = z.infer<typeof PrintInstructionsPayloadSchema>;
