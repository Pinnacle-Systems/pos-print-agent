import type { z } from "zod";
import { BarcodeHumanReadableSchema, BarcodeSymbologySchema, QrErrorCorrectionSchema, TextAlignSchema, TextSizeSchema } from "./print-instruction.schema";
import type {
  BarcodeInstruction,
  BlankInstruction,
  CutInstruction,
  FeedInstruction,
  LeftRightInstruction,
  LineInstruction,
  OpenDrawerInstruction,
  PrintInstructionsPayload,
  QrInstruction,
  TextInstruction,
} from "./print-instruction.schema";
import type { RenderedEscPosPayload } from "./print-instruction.types";

type TextAlign = z.infer<typeof TextAlignSchema>;
type TextSize = z.infer<typeof TextSizeSchema>;
type BarcodeSymbology = z.infer<typeof BarcodeSymbologySchema>;
type BarcodeHumanReadable = z.infer<typeof BarcodeHumanReadableSchema>;
type QrErrorCorrection = z.infer<typeof QrErrorCorrectionSchema>;

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// A fixed safety margin fed before every cut, on top of whatever explicit
// `feed` instructions the payload already contains - see README "Current
// limitations" for why this exists (thermal cutters can shear printed text
// if the paper hasn't cleared the blade).
const CUT_SAFETY_FEED_LINES = 3;

const ALIGN_CODES: Record<TextAlign, number> = { left: 0, center: 1, right: 2 };

// GS ! n: bits 0-3 encode (height multiplier - 1), bits 4-7 encode
// (width multiplier - 1). 0x00 = normal, 0x01 = double height, 0x10 =
// double width, 0x11 = double (both).
const SIZE_CODES: Record<TextSize, number> = {
  normal: 0x00,
  "double-width": 0x10,
  "double-height": 0x01,
  double: 0x11,
};

// GS k function-B (newer, explicit-length) system codes. See README
// "ESC/POS barcode command limitation" for why only these two are
// implemented and how CODE128 code-set prefixing works.
const BARCODE_SYSTEM_CODES: Record<BarcodeSymbology, number> = {
  CODE128: 73,
  EAN13: 67,
};

// GS H n: human-readable text position relative to the barcode.
const HRI_POSITION_CODES: Record<BarcodeHumanReadable, number> = {
  none: 0,
  above: 1,
  below: 2,
  both: 3,
};

// GS ( k ... fn=69 (0x45) error-correction level codes.
const QR_ERROR_CORRECTION_CODES: Record<QrErrorCorrection, number> = {
  L: 48,
  M: 49,
  Q: 50,
  H: 51,
};

/**
 * This renderer intentionally sticks to plain ASCII (0x20-0x7E). ESC/POS
 * code page selection (ESC t n) varies by printer model and is not
 * implemented here - any character outside printable ASCII is replaced
 * with "?" rather than risk sending printer-specific/undefined bytes. See
 * README "Current limitations".
 */
function toAsciiSafe(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "?");
}

function escPosInit(): Buffer {
  return Buffer.from([ESC, 0x40]);
}

function escPosAlign(align: TextAlign): Buffer {
  return Buffer.from([ESC, 0x61, ALIGN_CODES[align]]);
}

function escPosBold(on: boolean): Buffer {
  return Buffer.from([ESC, 0x45, on ? 1 : 0]);
}

function escPosUnderline(on: boolean): Buffer {
  return Buffer.from([ESC, 0x2d, on ? 1 : 0]);
}

function escPosSize(size: TextSize): Buffer {
  return Buffer.from([GS, 0x21, SIZE_CODES[size]]);
}

function escPosFeed(lines: number): Buffer {
  return Buffer.alloc(lines, LF);
}

function escPosCut(mode: CutInstruction["mode"]): Buffer {
  return Buffer.from([GS, 0x56, mode === "partial" ? 0x01 : 0x00]);
}

// ESC p 0 25 250 - a conservative, widely-supported default drawer kick
// pulse (pin 2, ~25ms on, ~250ms off). Kept isolated here so it can be
// swapped for a printer-specific pulse later without touching callers -
// see README "ESC/POS drawer command limitation".
function escPosOpenDrawer(): Buffer {
  return Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]);
}

/**
 * Breaks `value` into lines of at most `width` columns, wrapping on word
 * boundaries where possible. A single word longer than `width` is hard-split
 * rather than left to overflow (printer firmware wrap behavior for
 * over-length lines is inconsistent across models, so this renderer must not
 * depend on it - see the item-name-truncation fix this replaced).
 */
function wrapToWidth(value: string, width: number): string[] {
  if (value.length <= width) {
    return [value];
  }

  const lines: string[] = [];
  let current = "";

  for (const word of value.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
    }

    let remaining = word;
    while (remaining.length > width) {
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    current = remaining;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function renderTextInstruction(instruction: TextInstruction, width: number): Buffer {
  const lines = wrapToWidth(toAsciiSafe(instruction.value), width);
  const textLines = lines.map((line) => Buffer.concat([Buffer.from(line, "ascii"), Buffer.from([LF])]));

  return Buffer.concat([
    escPosAlign(instruction.align),
    escPosBold(instruction.bold),
    escPosUnderline(instruction.underline),
    escPosSize(instruction.size),
    ...textLines,
    // Reset styling after the line so it never leaks into the next
    // instruction (spec step "Reset bold/underline/size/alignment after
    // the line to avoid style leakage").
    escPosBold(false),
    escPosUnderline(false),
    escPosSize("normal"),
    escPosAlign("left"),
  ]);
}

function renderLineInstruction(instruction: LineInstruction, width: number): Buffer {
  return Buffer.concat([Buffer.from(instruction.char.repeat(width), "ascii"), Buffer.from([LF])]);
}

function renderFeedInstruction(instruction: FeedInstruction): Buffer {
  return escPosFeed(instruction.lines);
}

function renderCutInstruction(instruction: CutInstruction): Buffer {
  return Buffer.concat([escPosFeed(CUT_SAFETY_FEED_LINES), escPosCut(instruction.mode)]);
}

/**
 * Right-aligns `right` against `left` within `width` columns. The right
 * side always stays fully visible ("Keep right value visible" in the
 * spec); if there isn't room for both, `left` is truncated to whatever
 * space remains (possibly to nothing) rather than failing the print job.
 */
function formatLeftRight(left: string, right: string, width: number): string {
  const safeRight = right.length > width ? right.slice(0, width) : right;
  const availableForLeft = Math.max(width - safeRight.length - 1, 0);

  if (left.length <= availableForLeft) {
    const gap = Math.max(width - left.length - safeRight.length, 1);
    return `${left}${" ".repeat(gap)}${safeRight}`;
  }

  if (availableForLeft === 0) {
    return safeRight;
  }

  return `${left.slice(0, availableForLeft)} ${safeRight}`;
}

function renderLeftRightInstruction(instruction: LeftRightInstruction, width: number): Buffer {
  const line = formatLeftRight(instruction.left, instruction.right, width);
  return Buffer.concat([
    escPosBold(instruction.bold),
    escPosUnderline(instruction.underline),
    escPosSize(instruction.size),
    Buffer.from(toAsciiSafe(line), "ascii"),
    Buffer.from([LF]),
    escPosBold(false),
    escPosUnderline(false),
    escPosSize("normal"),
  ]);
}

function renderBlankInstruction(instruction: BlankInstruction): Buffer {
  return escPosFeed(instruction.lines);
}

function renderOpenDrawerInstruction(_instruction: OpenDrawerInstruction): Buffer {
  return escPosOpenDrawer();
}

function escPosBarcodeHeight(height: number): Buffer {
  return Buffer.from([GS, 0x68, height]);
}

function escPosBarcodeWidth(width: number): Buffer {
  return Buffer.from([GS, 0x77, width]);
}

function escPosBarcodeHri(position: BarcodeHumanReadable): Buffer {
  return Buffer.from([GS, 0x48, HRI_POSITION_CODES[position]]);
}

/**
 * Builds the raw data bytes for GS k (function B). EAN13 sends the digit
 * string as-is (already validated to 12-13 numeric digits by the schema).
 * CODE128 is prefixed with "{B" to select Code Set B, the common
 * convention for encoding printable ASCII on Epson-compatible printers -
 * see README "ESC/POS barcode command limitation" for why this is
 * conservative rather than guaranteed across every printer model.
 */
function buildBarcodeData(instruction: BarcodeInstruction): string {
  if (instruction.symbology === "CODE128") {
    return `{B${toAsciiSafe(instruction.value)}`;
  }
  return instruction.value;
}

// GS k m n d1...dn (function B / explicit length form).
function escPosBarcodePrint(instruction: BarcodeInstruction): Buffer {
  const data = Buffer.from(buildBarcodeData(instruction), "ascii");
  return Buffer.concat([Buffer.from([GS, 0x6b, BARCODE_SYSTEM_CODES[instruction.symbology], data.length]), data]);
}

function renderBarcodeInstruction(instruction: BarcodeInstruction): Buffer {
  return Buffer.concat([
    escPosAlign(instruction.align),
    escPosBarcodeHeight(instruction.height),
    escPosBarcodeWidth(instruction.width),
    escPosBarcodeHri(instruction.humanReadable),
    escPosBarcodePrint(instruction),
    escPosAlign("left"),
    Buffer.from([LF]),
  ]);
}

// GS ( k 04 00 31 41 n1 n2 - fixed to QR model 2 (the common default
// supported by virtually all ESC/POS QR-capable printers).
function escPosQrSelectModel(): Buffer {
  return Buffer.from([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
}

// GS ( k 03 00 31 43 n - module size (dots per module).
function escPosQrModuleSize(size: number): Buffer {
  return Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]);
}

// GS ( k 03 00 31 45 n - error correction level.
function escPosQrErrorCorrection(level: QrErrorCorrection): Buffer {
  return Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, QR_ERROR_CORRECTION_CODES[level]]);
}

// GS ( k pL pH 31 50 30 d1...dk - store QR data. pL/pH encode (data length + 3).
function escPosQrStoreData(value: string): Buffer {
  const data = Buffer.from(toAsciiSafe(value), "ascii");
  const storeLength = data.length + 3;
  const pL = storeLength & 0xff;
  const pH = (storeLength >> 8) & 0xff;
  return Buffer.concat([Buffer.from([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]), data]);
}

// GS ( k 03 00 31 51 30 - print the stored QR code.
function escPosQrPrint(): Buffer {
  return Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
}

function renderQrInstruction(instruction: QrInstruction): Buffer {
  return Buffer.concat([
    escPosAlign(instruction.align),
    escPosQrSelectModel(),
    escPosQrModuleSize(instruction.size),
    escPosQrErrorCorrection(instruction.errorCorrection),
    escPosQrStoreData(instruction.value),
    escPosQrPrint(),
    escPosAlign("left"),
    Buffer.from([LF]),
  ]);
}

export function renderEscPosInstructions(payload: PrintInstructionsPayload): RenderedEscPosPayload {
  const parts: Buffer[] = [escPosInit()];

  for (const instruction of payload.instructions) {
    switch (instruction.type) {
      case "text":
        parts.push(renderTextInstruction(instruction, payload.width));
        break;
      case "line":
        parts.push(renderLineInstruction(instruction, payload.width));
        break;
      case "feed":
        parts.push(renderFeedInstruction(instruction));
        break;
      case "cut":
        parts.push(renderCutInstruction(instruction));
        break;
      case "leftRight":
        parts.push(renderLeftRightInstruction(instruction, payload.width));
        break;
      case "blank":
        parts.push(renderBlankInstruction(instruction));
        break;
      case "openDrawer":
        parts.push(renderOpenDrawerInstruction(instruction));
        break;
      case "barcode":
        parts.push(renderBarcodeInstruction(instruction));
        break;
      case "qr":
        parts.push(renderQrInstruction(instruction));
        break;
    }
  }

  return { buffer: Buffer.concat(parts), instructionCount: payload.instructions.length };
}
