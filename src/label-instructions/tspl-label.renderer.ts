import type { TsplBarcodeInstruction, TsplBoxInstruction, TsplLabelPayload, TsplLineInstruction, TsplTextInstruction } from "./tspl-label.schema";
import type { RenderedTsplLabel } from "./tspl-label.types";

// TSPL is a line-oriented text command language (unlike ESC/POS's binary
// command bytes) - commands are terminated with CRLF, which is what real
// TSC/Zebra-TSPL-compatible printers expect on their serial/USB command
// channel.
const LINE_TERMINATOR = "\r\n";

/**
 * This renderer intentionally sticks to plain ASCII (0x20-0x7E), same
 * conservative rule as the ESC/POS receipt renderer - but implemented
 * separately here (not imported) so the TSPL and ESC/POS renderers stay
 * fully isolated from each other, per this project's architecture rule that
 * each command-language renderer is a self-contained conversion from
 * generic instructions to that language's bytes.
 */
function toAsciiSafe(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "?");
}

// TSPL string literals are double-quoted; a literal `"` inside the value
// must be escaped as `\"` or it would terminate the string early and
// desync the rest of the command line.
function escapeTsplString(value: string): string {
  return toAsciiSafe(value).replace(/"/g, '\\"');
}

function renderTextCommand(instruction: TsplTextInstruction): string {
  return `TEXT ${instruction.x},${instruction.y},"${instruction.font}",${instruction.rotation},${instruction.xMultiplier},${instruction.yMultiplier},"${escapeTsplString(instruction.value)}"`;
}

function renderBarcodeCommand(instruction: TsplBarcodeInstruction): string {
  const humanReadableFlag = instruction.humanReadable ? 1 : 0;
  return `BARCODE ${instruction.x},${instruction.y},"${instruction.symbology}",${instruction.height},${humanReadableFlag},${instruction.rotation},${instruction.narrow},${instruction.wide},"${escapeTsplString(instruction.value)}"`;
}

function renderBoxCommand(instruction: TsplBoxInstruction): string {
  return `BOX ${instruction.x},${instruction.y},${instruction.xEnd},${instruction.yEnd},${instruction.thickness}`;
}

// The generic "line" instruction maps to TSPL's BAR command (a solid
// filled rectangle) - TSPL has no separate thin-line primitive, so a
// horizontal/vertical rule is just a BAR with a small height/width.
function renderLineCommand(instruction: TsplLineInstruction): string {
  return `BAR ${instruction.x},${instruction.y},${instruction.width},${instruction.height}`;
}

/**
 * Converts a validated TSPL label payload into the full TSPL command
 * sequence for one label, ending in a single `PRINT 1`. Deliberately does
 * NOT emit `PRINT <copies>` here - print-job.service.ts loops this whole
 * rendered buffer once per requested copy (matching how the ESC/POS
 * receipt path repeats sendRawToPrinter() per copy), so each copy is sent
 * as its own independent, self-contained command sequence rather than
 * relying on the printer's own copy-count handling.
 */
export function renderTsplLabel(payload: TsplLabelPayload): RenderedTsplLabel {
  const lines: string[] = [
    `SIZE ${payload.labelWidthMm} mm,${payload.labelHeightMm} mm`,
    `GAP ${payload.gapMm} mm,0 mm`,
    `DENSITY ${payload.density}`,
    `SPEED ${payload.speed}`,
    `DIRECTION ${payload.direction}`,
    `REFERENCE ${payload.referenceX},${payload.referenceY}`,
    "CLS",
  ];

  for (const instruction of payload.instructions) {
    switch (instruction.type) {
      case "text":
        lines.push(renderTextCommand(instruction));
        break;
      case "barcode":
        lines.push(renderBarcodeCommand(instruction));
        break;
      case "box":
        lines.push(renderBoxCommand(instruction));
        break;
      case "line":
        lines.push(renderLineCommand(instruction));
        break;
    }
  }

  lines.push("PRINT 1");

  const buffer = Buffer.from(lines.join(LINE_TERMINATOR) + LINE_TERMINATOR, "ascii");
  return { buffer, instructionCount: payload.instructions.length };
}
