import { z } from "zod";

// Kept in sync with the discriminated union below - used by print-job.service.ts
// to distinguish "unknown instruction type" (INSTRUCTION_TYPE_NOT_IMPLEMENTED)
// from "known type, malformed fields" (INVALID_PRINT_PAYLOAD) before the
// stricter per-type schemas below ever run.
export const KNOWN_INSTRUCTION_TYPES = [
  "text",
  "line",
  "feed",
  "cut",
  "leftRight",
  "blank",
  "openDrawer",
  "barcode",
  "qr",
] as const;
export type KnownInstructionType = (typeof KNOWN_INSTRUCTION_TYPES)[number];

const MAX_TEXT_VALUE_LENGTH = 500;
const MAX_LEFT_RIGHT_LEFT_LENGTH = 250;
const MAX_LEFT_RIGHT_RIGHT_LENGTH = 100;
const MAX_BARCODE_VALUE_LENGTH = 80;
const MAX_QR_VALUE_LENGTH = 500;
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

export const BarcodeSymbologySchema = z.enum(["CODE128", "EAN13"]);
export const BarcodeHumanReadableSchema = z.enum(["none", "above", "below", "both"]);

export const BarcodeInstructionSchema = z.object({
  type: z.literal("barcode"),
  value: z.string().min(1, "barcode value is required").max(MAX_BARCODE_VALUE_LENGTH, `barcode value must be at most ${MAX_BARCODE_VALUE_LENGTH} characters`),
  symbology: BarcodeSymbologySchema.default("CODE128"),
  height: z.number().int().min(40, "barcode height must be between 40 and 160").max(160, "barcode height must be between 40 and 160").default(80),
  width: z.number().int().min(2, "barcode width must be between 2 and 6").max(6, "barcode width must be between 2 and 6").default(2),
  humanReadable: BarcodeHumanReadableSchema.default("below"),
  align: TextAlignSchema.default("center"),
});

export const QrErrorCorrectionSchema = z.enum(["L", "M", "Q", "H"]);

export const QrInstructionSchema = z.object({
  type: z.literal("qr"),
  value: z.string().min(1, "qr value is required").max(MAX_QR_VALUE_LENGTH, `qr value must be at most ${MAX_QR_VALUE_LENGTH} characters`),
  size: z.number().int().min(3, "qr size must be between 3 and 10").max(10, "qr size must be between 3 and 10").default(6),
  errorCorrection: QrErrorCorrectionSchema.default("M"),
  align: TextAlignSchema.default("center"),
});

const EAN13_VALUE_PATTERN = /^\d{12,13}$/;

// discriminatedUnion requires each member to be a plain ZodObject, so the
// EAN13-specific "value must be 12-13 numeric digits" cross-field rule
// (depends on both `symbology` and `value`) can't live on
// BarcodeInstructionSchema itself (a .refine() there would turn it into a
// ZodEffects and break the union). It's applied here instead, after the
// union has already picked "barcode" out by its `type` literal.
export const PrintInstructionSchema = z
  .discriminatedUnion("type", [
    TextInstructionSchema,
    LineInstructionSchema,
    FeedInstructionSchema,
    CutInstructionSchema,
    LeftRightInstructionSchema,
    BlankInstructionSchema,
    OpenDrawerInstructionSchema,
    BarcodeInstructionSchema,
    QrInstructionSchema,
  ])
  .superRefine((instruction, ctx) => {
    if (instruction.type === "barcode" && instruction.symbology === "EAN13" && !EAN13_VALUE_PATTERN.test(instruction.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "EAN13 barcode value must contain exactly 12 or 13 numeric digits",
        path: ["value"],
      });
    }
  });

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
export type BarcodeInstruction = z.infer<typeof BarcodeInstructionSchema>;
export type QrInstruction = z.infer<typeof QrInstructionSchema>;
export type PrintInstruction = z.infer<typeof PrintInstructionSchema>;
export type PrintInstructionsPayload = z.infer<typeof PrintInstructionsPayloadSchema>;
