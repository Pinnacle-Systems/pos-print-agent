import { z } from "zod";

// Kept in sync with the discriminated union below - used by print-job.service.ts
// to distinguish "unknown label instruction type" (INSTRUCTION_TYPE_NOT_IMPLEMENTED)
// from "known type, malformed fields" (INVALID_PRINT_PAYLOAD) before the
// stricter per-type schemas below ever run. Deliberately a separate list from
// print-instruction.schema.ts's KNOWN_INSTRUCTION_TYPES - label printers are a
// different instruction vocabulary (coordinate-based) from receipt printers.
export const KNOWN_LABEL_INSTRUCTION_TYPES = ["text", "barcode", "box", "line"] as const;
export type KnownLabelInstructionType = (typeof KNOWN_LABEL_INSTRUCTION_TYPES)[number];

const MAX_TEXT_VALUE_LENGTH = 250;
const MAX_BARCODE_VALUE_LENGTH = 80;
export const MAX_LABEL_INSTRUCTION_COUNT = 100;

const COORDINATE_MIN = 0;
const COORDINATE_MAX = 2000;

function coordinateField(label: string) {
  return z
    .number()
    .int()
    .min(COORDINATE_MIN, `${label} must be between ${COORDINATE_MIN} and ${COORDINATE_MAX}`)
    .max(COORDINATE_MAX, `${label} must be between ${COORDINATE_MIN} and ${COORDINATE_MAX}`);
}

export const TsplFontSchema = z.enum(["1", "2", "3", "4", "5", "TSS24.BF2", "TSS16.BF2"]);
export const TsplRotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export const TsplBarcodeSymbologySchema = z.enum(["128", "EAN13", "EAN8"]);

export const TsplTextInstructionSchema = z.object({
  type: z.literal("text"),
  x: coordinateField("x"),
  y: coordinateField("y"),
  value: z.string().min(1, "text value is required").max(MAX_TEXT_VALUE_LENGTH, `text value must be at most ${MAX_TEXT_VALUE_LENGTH} characters`),
  font: TsplFontSchema.default("3"),
  rotation: TsplRotationSchema.default(0),
  xMultiplier: z.number().int().min(1, "xMultiplier must be between 1 and 10").max(10, "xMultiplier must be between 1 and 10").default(1),
  yMultiplier: z.number().int().min(1, "yMultiplier must be between 1 and 10").max(10, "yMultiplier must be between 1 and 10").default(1),
});

export const TsplBarcodeInstructionSchema = z.object({
  type: z.literal("barcode"),
  x: coordinateField("x"),
  y: coordinateField("y"),
  value: z
    .string()
    .min(1, "barcode value is required")
    .max(MAX_BARCODE_VALUE_LENGTH, `barcode value must be at most ${MAX_BARCODE_VALUE_LENGTH} characters`),
  symbology: TsplBarcodeSymbologySchema.default("128"),
  height: z.number().int().min(20, "barcode height must be between 20 and 300").max(300, "barcode height must be between 20 and 300").default(60),
  humanReadable: z.boolean().default(true),
  rotation: TsplRotationSchema.default(0),
  narrow: z.number().int().min(1, "narrow must be between 1 and 10").max(10, "narrow must be between 1 and 10").default(2),
  wide: z.number().int().min(1, "wide must be between 1 and 10").max(10, "wide must be between 1 and 10").default(2),
});

export const TsplBoxInstructionSchema = z.object({
  type: z.literal("box"),
  x: coordinateField("x"),
  y: coordinateField("y"),
  xEnd: coordinateField("xEnd"),
  yEnd: coordinateField("yEnd"),
  thickness: z.number().int().min(1, "thickness must be between 1 and 10").max(10, "thickness must be between 1 and 10").default(1),
});

export const TsplLineInstructionSchema = z.object({
  type: z.literal("line"),
  x: coordinateField("x"),
  y: coordinateField("y"),
  width: z.number().int().min(1, "width must be between 1 and 2000").max(2000, "width must be between 1 and 2000"),
  height: z.number().int().min(1, "height must be between 1 and 2000").max(2000, "height must be between 1 and 2000"),
});

const EAN13_VALUE_PATTERN = /^\d{12,13}$/;
const EAN8_VALUE_PATTERN = /^\d{7,8}$/;

// discriminatedUnion requires each member to be a plain ZodObject, so the
// cross-field rules below (EAN13/EAN8 digit-length depends on both
// `symbology` and `value`; box coordinate ordering depends on both `x`/`xEnd`
// and `y`/`yEnd`) can't live on the individual instruction schemas
// themselves (a .refine() there would turn it into a ZodEffects and break
// the union) - see the identical pattern in print-instruction.schema.ts.
export const TsplLabelInstructionSchema = z
  .discriminatedUnion("type", [TsplTextInstructionSchema, TsplBarcodeInstructionSchema, TsplBoxInstructionSchema, TsplLineInstructionSchema])
  .superRefine((instruction, ctx) => {
    if (instruction.type === "barcode") {
      if (instruction.symbology === "EAN13" && !EAN13_VALUE_PATTERN.test(instruction.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "EAN13 barcode value must contain exactly 12 or 13 numeric digits",
          path: ["value"],
        });
      }
      if (instruction.symbology === "EAN8" && !EAN8_VALUE_PATTERN.test(instruction.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "EAN8 barcode value must contain exactly 7 or 8 numeric digits",
          path: ["value"],
        });
      }
    }

    if (instruction.type === "box") {
      if (instruction.xEnd <= instruction.x) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "xEnd must be greater than x", path: ["xEnd"] });
      }
      if (instruction.yEnd <= instruction.y) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "yEnd must be greater than y", path: ["yEnd"] });
      }
    }
  });

export const TsplLabelPayloadSchema = z.object({
  labelWidthMm: z.number().min(20, "labelWidthMm must be between 20 and 110").max(110, "labelWidthMm must be between 20 and 110"),
  labelHeightMm: z.number().min(10, "labelHeightMm must be between 10 and 150").max(150, "labelHeightMm must be between 10 and 150"),
  gapMm: z.number().min(0, "gapMm must be between 0 and 10").max(10, "gapMm must be between 0 and 10").default(3),
  density: z.number().int().min(0, "density must be between 0 and 15").max(15, "density must be between 0 and 15").default(8),
  speed: z.number().min(1, "speed must be between 1 and 8").max(8, "speed must be between 1 and 8").default(4),
  direction: z.union([z.literal(0), z.literal(1)]).default(1),
  referenceX: z.number().int().min(0, "referenceX must be between 0 and 999").max(999, "referenceX must be between 0 and 999").default(0),
  referenceY: z.number().int().min(0, "referenceY must be between 0 and 999").max(999, "referenceY must be between 0 and 999").default(0),
  instructions: z
    .array(TsplLabelInstructionSchema)
    .min(1, "instructions must be a non-empty array")
    .max(MAX_LABEL_INSTRUCTION_COUNT, `instructions must not exceed ${MAX_LABEL_INSTRUCTION_COUNT} items`),
});

export type TsplTextInstruction = z.infer<typeof TsplTextInstructionSchema>;
export type TsplBarcodeInstruction = z.infer<typeof TsplBarcodeInstructionSchema>;
export type TsplBoxInstruction = z.infer<typeof TsplBoxInstructionSchema>;
export type TsplLineInstruction = z.infer<typeof TsplLineInstructionSchema>;
export type TsplLabelInstruction = z.infer<typeof TsplLabelInstructionSchema>;
export type TsplLabelPayload = z.infer<typeof TsplLabelPayloadSchema>;
