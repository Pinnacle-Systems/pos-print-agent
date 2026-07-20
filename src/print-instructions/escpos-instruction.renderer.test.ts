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

// A lone "text" instruction always emits, in order: init (2 bytes), align
// (3), bold (3), underline (3), size (3), then one or more "<line>\n"
// bodies, then the same 12-byte reset block used by every text instruction.
const TEXT_BODY_OFFSET = 2 + 3 + 3 + 3 + 3;
const TEXT_RESET_BLOCK_LENGTH = 12;

function renderTextLines(value: string, width: number): string[] {
  const { buffer } = render([{ type: "text", value }], width);
  const body = buffer.subarray(TEXT_BODY_OFFSET, buffer.length - TEXT_RESET_BLOCK_LENGTH);
  // Trailing LF after the final line would otherwise produce an empty
  // trailing element from split("\n").
  return body.toString("ascii").split("\n").slice(0, -1);
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

  describe("text instruction word-wrapping", () => {
    it("does not wrap a value that already fits within the width", () => {
      expect(renderTextLines("Short Item", 48)).toEqual(["Short Item"]);
    });

    it("wraps a long value onto multiple lines at word boundaries, never exceeding the width", () => {
      const name = "Mars Collar With Pocket Ice Blue M Size(610910)";
      const lines = renderTextLines(name, 32);
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(32);
      }
      expect(lines.join(" ")).toBe(name);
    });

    it("hard-splits a single word longer than the width instead of overflowing", () => {
      const name = "Supercalifragilisticexpialidocious"; // 35 chars, no spaces
      const width = 32;
      const lines = renderTextLines(name, width);
      expect(lines.every((line) => line.length <= width)).toBe(true);
      expect(lines.join("")).toBe(name);
      expect(lines.length).toBe(2);
    });

    it("wraps identically in shape at both 32 and 48 column widths", () => {
      const name = "Premium Cotton Formal Shirt Full Sleeve Slim Fit";
      for (const width of [32, 48]) {
        const lines = renderTextLines(name, width);
        expect(lines.join(" ")).toBe(name);
        for (const line of lines) {
          expect(line.length).toBeLessThanOrEqual(width);
        }
      }
    });

    it("keeps consecutive wrapped text instructions independent of each other", () => {
      const { buffer } = render(
        [
          { type: "text", value: "Extra Long First Item Name That Wraps Around", bold: true },
          { type: "text", value: "Second Item", bold: true },
        ],
        32,
      );
      expect(buffer.toString("ascii")).toContain("Second Item");
      // First item's wrapped lines all precede the second item's line.
      const secondIndex = buffer.indexOf(Buffer.from("Second Item", "ascii"));
      const firstWordIndex = buffer.indexOf(Buffer.from("Extra", "ascii"));
      expect(firstWordIndex).toBeGreaterThanOrEqual(0);
      expect(secondIndex).toBeGreaterThan(firstWordIndex);
    });
  });

  it("reports instructionCount matching the number of instructions", () => {
    const { instructionCount } = render([
      { type: "text", value: "a" },
      { type: "blank" },
      { type: "cut" },
    ]);
    expect(instructionCount).toBe(3);
  });

  describe("barcode instruction", () => {
    it("emits GS k with the CODE128 system code and {B-prefixed data", () => {
      const { buffer } = render([{ type: "barcode", value: "INV1001", symbology: "CODE128" }]);
      const body = buffer.subarray(2);
      // align(3) + height(3) + width(3) + HRI(3) = 12 bytes before GS k.
      const gsKIndex = 12;
      expect(body.subarray(gsKIndex, gsKIndex + 3)).toEqual(Buffer.from([GS, 0x6b, 73]));
      const dataLength = body[gsKIndex + 3];
      const data = body.subarray(gsKIndex + 4, gsKIndex + 4 + dataLength).toString("ascii");
      expect(data).toBe("{BINV1001");
    });

    it("emits GS k with the EAN13 system code and the raw digit value", () => {
      const { buffer } = render([{ type: "barcode", value: "123456789012", symbology: "EAN13" }]);
      const body = buffer.subarray(2);
      const gsKIndex = 12;
      expect(body.subarray(gsKIndex, gsKIndex + 3)).toEqual(Buffer.from([GS, 0x6b, 67]));
      const dataLength = body[gsKIndex + 3];
      const data = body.subarray(gsKIndex + 4, gsKIndex + 4 + dataLength).toString("ascii");
      expect(data).toBe("123456789012");
    });

    it("rejects an EAN13 value that isn't 12-13 numeric digits", () => {
      expect(() => render([{ type: "barcode", value: "123", symbology: "EAN13" }])).toThrow();
      expect(() => render([{ type: "barcode", value: "12345678901234", symbology: "EAN13" }])).toThrow();
      expect(() => render([{ type: "barcode", value: "12345678901A", symbology: "EAN13" }])).toThrow();
    });

    it("sets the barcode height via GS h n", () => {
      const { buffer } = render([{ type: "barcode", value: "INV1001", height: 120 }]);
      const body = buffer.subarray(2);
      // align(3), then GS h n.
      expect(body.subarray(3, 6)).toEqual(Buffer.from([GS, 0x68, 120]));
    });

    it("sets the barcode width via GS w n", () => {
      const { buffer } = render([{ type: "barcode", value: "INV1001", width: 5 }]);
      const body = buffer.subarray(2);
      // align(3) + height(3), then GS w n.
      expect(body.subarray(6, 9)).toEqual(Buffer.from([GS, 0x77, 5]));
    });

    it("sets the human-readable text position via GS H n", () => {
      const { buffer } = render([{ type: "barcode", value: "INV1001", humanReadable: "both" }]);
      const body = buffer.subarray(2);
      // align(3) + height(3) + width(3), then GS H n.
      expect(body.subarray(9, 12)).toEqual(Buffer.from([GS, 0x48, 3]));
    });

    it("resets alignment to left after the barcode and adds a trailing line feed", () => {
      const { buffer } = render([{ type: "barcode", value: "INV1001", align: "center" }]);
      expect(buffer.subarray(buffer.length - 4)).toEqual(Buffer.from([ESC, 0x61, 0x00, LF]));
    });

    it("applies the default height/width/humanReadable/align/symbology when omitted", () => {
      const { buffer } = render([{ type: "barcode", value: "INV1001" }]);
      const body = buffer.subarray(2);
      expect(body.subarray(0, 3)).toEqual(Buffer.from([ESC, 0x61, 0x01])); // align center
      expect(body.subarray(3, 6)).toEqual(Buffer.from([GS, 0x68, 80])); // height 80
      expect(body.subarray(6, 9)).toEqual(Buffer.from([GS, 0x77, 2])); // width 2
      expect(body.subarray(9, 12)).toEqual(Buffer.from([GS, 0x48, 2])); // humanReadable below
    });
  });

  describe("qr instruction", () => {
    it("emits the QR select-model, store, and print command bytes", () => {
      const { buffer } = render([{ type: "qr", value: "https://example.com/i/1" }]);
      const body = buffer.subarray(2);
      // align(3), then select model.
      expect(body.subarray(3, 12)).toEqual(Buffer.from([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]));
      // print command should appear before the trailing align-reset + LF.
      const printBytes = Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
      expect(body.includes(printBytes)).toBe(true);
    });

    it("sets the QR module size via GS ( k ... fn=67", () => {
      const { buffer } = render([{ type: "qr", value: "https://example.com/i/1", size: 8 }]);
      const body = buffer.subarray(2);
      // align(3) + select-model(9), then module size.
      expect(body.subarray(12, 20)).toEqual(Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 8]));
    });

    it("sets the QR error correction level via GS ( k ... fn=69", () => {
      const { buffer } = render([{ type: "qr", value: "https://example.com/i/1", errorCorrection: "H" }]);
      const body = buffer.subarray(2);
      // align(3) + select-model(9) + module-size(8), then error correction.
      expect(body.subarray(20, 28)).toEqual(Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 51]));
    });

    it("stores the QR data with a length-prefixed GS ( k ... fn=80 command", () => {
      const value = "https://example.com/i/1";
      const { buffer } = render([{ type: "qr", value }]);
      const body = buffer.subarray(2);
      // align(3) + select-model(9) + module-size(8) + error-correction(8) = 28.
      const storeIndex = 28;
      const storeLength = value.length + 3;
      expect(body.subarray(storeIndex, storeIndex + 8)).toEqual(
        Buffer.from([GS, 0x28, 0x6b, storeLength & 0xff, (storeLength >> 8) & 0xff, 0x31, 0x50, 0x30]),
      );
      expect(body.subarray(storeIndex + 8, storeIndex + 8 + value.length).toString("ascii")).toBe(value);
    });

    it("resets alignment to left after the QR code and adds a trailing line feed", () => {
      const { buffer } = render([{ type: "qr", value: "https://example.com/i/1", align: "center" }]);
      expect(buffer.subarray(buffer.length - 4)).toEqual(Buffer.from([ESC, 0x61, 0x00, LF]));
    });
  });
});
