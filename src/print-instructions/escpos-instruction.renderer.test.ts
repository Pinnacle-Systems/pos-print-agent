import { describe, expect, it } from "vitest";
import { renderEscPosInstructions } from "./escpos-instruction.renderer";
import { PrintInstructionsPayloadSchema } from "./print-instruction.schema";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// payload.width is validated to the 32-48 range used by real receipt
// printers (58mm/80mm rolls) - see print-instruction.schema.ts.
const MIN_WIDTH = 32;

function render(instructions: unknown[], width = 42) {
  const payload = PrintInstructionsPayloadSchema.parse({ width, instructions });
  return renderEscPosInstructions(payload);
}

// A single leftRight instruction always emits, in order: init (2 bytes),
// bold (3), underline (3), size (3), then the formatted text itself - so
// the text always starts at a fixed offset for a lone leftRight payload.
const LEFT_RIGHT_TEXT_OFFSET = 2 + 3 + 3 + 3;

function renderLeftRightLine(left: string, right: string, width: number): string {
  const { buffer } = render([{ type: "leftRight", left, right }], width);
  const lfIndex = buffer.indexOf(LF, LEFT_RIGHT_TEXT_OFFSET);
  return buffer.subarray(LEFT_RIGHT_TEXT_OFFSET, lfIndex).toString("ascii");
}

describe("renderEscPosInstructions", () => {
  it("always starts with the ESC @ init bytes", () => {
    const { buffer } = render([{ type: "text", value: "hi" }]);
    expect(buffer.subarray(0, 2)).toEqual(Buffer.from([ESC, 0x40]));
  });

  it("renders a line instruction repeated to the payload width", () => {
    const { buffer } = render([{ type: "line", char: "-" }], MIN_WIDTH);
    expect(buffer.subarray(2, 2 + MIN_WIDTH).toString("ascii")).toBe("-".repeat(MIN_WIDTH));
    expect(buffer[2 + MIN_WIDTH]).toBe(LF);
  });

  it("renders a feed instruction as that many LF bytes", () => {
    const { buffer } = render([{ type: "feed", lines: 4 }]);
    expect(buffer.subarray(2)).toEqual(Buffer.alloc(4, LF));
  });

  it("renders a cut instruction with a safety feed followed by the cut bytes", () => {
    const { buffer } = render([{ type: "cut", mode: "full" }]);
    const body = buffer.subarray(2);
    // 3-line safety feed, then GS V 0 (full cut).
    expect(body).toEqual(Buffer.concat([Buffer.alloc(3, LF), Buffer.from([GS, 0x56, 0x00])]));
  });

  it("renders a partial cut with GS V 1", () => {
    const { buffer } = render([{ type: "cut", mode: "partial" }]);
    const cutBytes = buffer.subarray(buffer.length - 3);
    expect(cutBytes).toEqual(Buffer.from([GS, 0x56, 0x01]));
  });

  it("right-aligns leftRight text to fill the full width", () => {
    const width = 42;
    const left = "Grand Total";
    const right = "1300.00";
    const line = renderLeftRightLine(left, right, width);
    expect(line.length).toBe(width);
    expect(line.startsWith(left)).toBe(true);
    expect(line.endsWith(right)).toBe(true);
    expect(line).toBe(`${left}${" ".repeat(width - left.length - right.length)}${right}`);
  });

  it("truncates a leftRight left value that would overflow the width, keeping right intact", () => {
    const width = MIN_WIDTH;
    const left = "Very Long Product Name That Is Too Long";
    const right = "123.00";
    const line = renderLeftRightLine(left, right, width);
    expect(line.length).toBe(width);
    expect(line.endsWith(right)).toBe(true);
    expect(left.startsWith(line.slice(0, line.indexOf(" ")))).toBe(true);
  });

  it("keeps the right value visible even when it alone fills the width", () => {
    const width = MIN_WIDTH;
    const right = "1".repeat(width);
    const line = renderLeftRightLine("Total", right, width);
    expect(line).toBe(right);
  });

  it("renders blank as the requested number of LF bytes, defaulting to 1", () => {
    const { buffer: withDefault } = render([{ type: "blank" }]);
    expect(withDefault.subarray(2)).toEqual(Buffer.from([LF]));

    const { buffer: withLines } = render([{ type: "blank", lines: 3 }]);
    expect(withLines.subarray(2)).toEqual(Buffer.alloc(3, LF));
  });

  it("renders openDrawer as the ESC p 0 25 250 kick command", () => {
    const { buffer } = render([{ type: "openDrawer" }]);
    expect(buffer.subarray(2)).toEqual(Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]));
  });

  it("does not open the drawer unless an openDrawer instruction is present", () => {
    const { buffer } = render([{ type: "text", value: "no drawer here" }, { type: "cut" }]);
    expect(buffer.includes(Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]))).toBe(false);
  });

  it("resets bold/underline/size/alignment after a styled text line so a following instruction isn't affected", () => {
    const { buffer } = render([
      { type: "text", value: "BOLD", align: "center", bold: true, underline: true, size: "double" },
      { type: "line", char: "-" },
    ]);
    const textLfIndex = buffer.indexOf(Buffer.from("BOLD", "ascii")) + 4;
    expect(buffer[textLfIndex]).toBe(LF);
    const resetBlock = buffer.subarray(textLfIndex + 1, textLfIndex + 13);
    expect(resetBlock).toEqual(
      Buffer.from([
        ESC,
        0x45,
        0x00, // bold off
        ESC,
        0x2d,
        0x00, // underline off
        GS,
        0x21,
        0x00, // size normal
        ESC,
        0x61,
        0x00, // align left
      ]),
    );
  });

  it("reports instructionCount matching the number of instructions", () => {
    const { instructionCount } = render([
      { type: "text", value: "a" },
      { type: "blank" },
      { type: "cut" },
    ]);
    expect(instructionCount).toBe(3);
  });
});
