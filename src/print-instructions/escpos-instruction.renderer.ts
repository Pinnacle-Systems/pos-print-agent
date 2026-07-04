import type { z } from "zod";
import { TextAlignSchema, TextSizeSchema } from "./print-instruction.schema";
import type {
  BlankInstruction,
  CutInstruction,
  FeedInstruction,
  LeftRightInstruction,
  LineInstruction,
  OpenDrawerInstruction,
  PrintInstructionsPayload,
  TextInstruction,
} from "./print-instruction.schema";
import type { RenderedEscPosPayload } from "./print-instruction.types";

type TextAlign = z.infer<typeof TextAlignSchema>;
type TextSize = z.infer<typeof TextSizeSchema>;

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

function renderTextInstruction(instruction: TextInstruction): Buffer {
  return Buffer.concat([
    escPosAlign(instruction.align),
    escPosBold(instruction.bold),
    escPosUnderline(instruction.underline),
    escPosSize(instruction.size),
    Buffer.from(toAsciiSafe(instruction.value), "ascii"),
    Buffer.from([LF]),
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

export function renderEscPosInstructions(payload: PrintInstructionsPayload): RenderedEscPosPayload {
  const parts: Buffer[] = [escPosInit()];

  for (const instruction of payload.instructions) {
    switch (instruction.type) {
      case "text":
        parts.push(renderTextInstruction(instruction));
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
    }
  }

  return { buffer: Buffer.concat(parts), instructionCount: payload.instructions.length };
}
