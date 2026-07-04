import { describe, expect, it } from "vitest";
import { renderTsplLabel } from "./tspl-label.renderer";
import { TsplLabelPayloadSchema } from "./tspl-label.schema";

function render(payload: unknown) {
  const parsed = TsplLabelPayloadSchema.parse(payload);
  return renderTsplLabel(parsed);
}

function renderLines(payload: unknown): string[] {
  const { buffer } = render(payload);
  return buffer.toString("ascii").split("\r\n").filter((line) => line.length > 0);
}

const BASE_PAYLOAD = {
  labelWidthMm: 50,
  labelHeightMm: 25,
  instructions: [{ type: "text", x: 20, y: 20, value: "Polo T-Shirt" }],
};

describe("renderTsplLabel", () => {
  it("emits the SIZE command from labelWidthMm/labelHeightMm", () => {
    const lines = renderLines(BASE_PAYLOAD);
    expect(lines[0]).toBe("SIZE 50 mm,25 mm");
  });

  it("emits the GAP command using gapMm, defaulting to 3", () => {
    const lines = renderLines(BASE_PAYLOAD);
    expect(lines[1]).toBe("GAP 3 mm,0 mm");

    const withGap = renderLines({ ...BASE_PAYLOAD, gapMm: 5 });
    expect(withGap[1]).toBe("GAP 5 mm,0 mm");
  });

  it("emits the DENSITY command, defaulting to 8", () => {
    const lines = renderLines(BASE_PAYLOAD);
    expect(lines[2]).toBe("DENSITY 8");
  });

  it("emits the SPEED command, defaulting to 4", () => {
    const lines = renderLines(BASE_PAYLOAD);
    expect(lines[3]).toBe("SPEED 4");
  });

  it("emits the DIRECTION command, defaulting to 1", () => {
    const lines = renderLines(BASE_PAYLOAD);
    expect(lines[4]).toBe("DIRECTION 1");
  });

  it("emits the REFERENCE command, defaulting to 0,0", () => {
    const lines = renderLines(BASE_PAYLOAD);
    expect(lines[5]).toBe("REFERENCE 0,0");

    const withRef = renderLines({ ...BASE_PAYLOAD, referenceX: 10, referenceY: 20 });
    expect(withRef[5]).toBe("REFERENCE 10,20");
  });

  it("emits CLS right after the header commands", () => {
    const lines = renderLines(BASE_PAYLOAD);
    expect(lines[6]).toBe("CLS");
  });

  it("emits a TEXT command with x,y,font,rotation,multipliers,value", () => {
    const lines = renderLines({
      ...BASE_PAYLOAD,
      instructions: [{ type: "text", x: 20, y: 20, value: "Polo T-Shirt", font: "3", rotation: 0, xMultiplier: 1, yMultiplier: 1 }],
    });
    expect(lines).toContain('TEXT 20,20,"3",0,1,1,"Polo T-Shirt"');
  });

  it("emits a BARCODE command with x,y,symbology,height,humanReadableFlag,rotation,narrow,wide,value", () => {
    const lines = renderLines({
      ...BASE_PAYLOAD,
      instructions: [
        { type: "barcode", x: 20, y: 60, value: "8901234567890", symbology: "EAN13", height: 60, humanReadable: true, rotation: 0, narrow: 2, wide: 2 },
      ],
    });
    expect(lines).toContain('BARCODE 20,60,"EAN13",60,1,0,2,2,"8901234567890"');
  });

  it("renders humanReadable: false as a 0 flag", () => {
    const lines = renderLines({
      ...BASE_PAYLOAD,
      instructions: [{ type: "barcode", x: 20, y: 60, value: "123456789012", symbology: "128", humanReadable: false }],
    });
    expect(lines.some((line) => line.startsWith('BARCODE 20,60,"128",60,0,'))).toBe(true);
  });

  it("emits a BOX command with x,y,xEnd,yEnd,thickness", () => {
    const lines = renderLines({
      ...BASE_PAYLOAD,
      instructions: [{ type: "box", x: 0, y: 0, xEnd: 390, yEnd: 190, thickness: 2 }],
    });
    expect(lines).toContain("BOX 0,0,390,190,2");
  });

  it("emits a BAR command for a line instruction", () => {
    const lines = renderLines({
      ...BASE_PAYLOAD,
      instructions: [{ type: "line", x: 0, y: 100, width: 390, height: 2 }],
    });
    expect(lines).toContain("BAR 0,100,390,2");
  });

  it("ends with a single PRINT 1 command, regardless of instruction count", () => {
    const lines = renderLines({
      ...BASE_PAYLOAD,
      instructions: [
        { type: "text", x: 20, y: 20, value: "Line one" },
        { type: "text", x: 20, y: 140, value: "Line two" },
      ],
    });
    expect(lines[lines.length - 1]).toBe("PRINT 1");
    expect(lines.filter((line) => line.startsWith("PRINT")).length).toBe(1);
  });

  it("escapes double quotes in a text value", () => {
    const lines = renderLines({
      ...BASE_PAYLOAD,
      instructions: [{ type: "text", x: 20, y: 20, value: 'Size 32" Waist' }],
    });
    expect(lines).toContain('TEXT 20,20,"3",0,1,1,"Size 32\\" Waist"');
  });

  it("rejects an EAN13 barcode value that isn't 12-13 numeric digits", () => {
    expect(() =>
      render({ ...BASE_PAYLOAD, instructions: [{ type: "barcode", x: 0, y: 0, value: "123", symbology: "EAN13" }] }),
    ).toThrow();
    expect(() =>
      render({ ...BASE_PAYLOAD, instructions: [{ type: "barcode", x: 0, y: 0, value: "12345678901234", symbology: "EAN13" }] }),
    ).toThrow();
  });

  it("accepts a valid EAN13 barcode value (12 or 13 digits)", () => {
    expect(() => render({ ...BASE_PAYLOAD, instructions: [{ type: "barcode", x: 0, y: 0, value: "123456789012", symbology: "EAN13" }] })).not.toThrow();
    expect(() => render({ ...BASE_PAYLOAD, instructions: [{ type: "barcode", x: 0, y: 0, value: "1234567890123", symbology: "EAN13" }] })).not.toThrow();
  });

  it("rejects an EAN8 barcode value that isn't 7-8 numeric digits", () => {
    expect(() =>
      render({ ...BASE_PAYLOAD, instructions: [{ type: "barcode", x: 0, y: 0, value: "123", symbology: "EAN8" }] }),
    ).toThrow();
    expect(() =>
      render({ ...BASE_PAYLOAD, instructions: [{ type: "barcode", x: 0, y: 0, value: "123456789", symbology: "EAN8" }] }),
    ).toThrow();
  });

  it("accepts a valid EAN8 barcode value (7 or 8 digits)", () => {
    expect(() => render({ ...BASE_PAYLOAD, instructions: [{ type: "barcode", x: 0, y: 0, value: "1234567", symbology: "EAN8" }] })).not.toThrow();
    expect(() => render({ ...BASE_PAYLOAD, instructions: [{ type: "barcode", x: 0, y: 0, value: "12345678", symbology: "EAN8" }] })).not.toThrow();
  });

  it("rejects box coordinates where xEnd/yEnd don't exceed x/y", () => {
    expect(() =>
      render({ ...BASE_PAYLOAD, instructions: [{ type: "box", x: 100, y: 0, xEnd: 100, yEnd: 190, thickness: 1 }] }),
    ).toThrow();
    expect(() =>
      render({ ...BASE_PAYLOAD, instructions: [{ type: "box", x: 0, y: 100, xEnd: 390, yEnd: 100, thickness: 1 }] }),
    ).toThrow();
  });

  it("reports instructionCount matching the number of instructions", () => {
    const { instructionCount } = render({
      ...BASE_PAYLOAD,
      instructions: [
        { type: "text", x: 20, y: 20, value: "a" },
        { type: "line", x: 0, y: 100, width: 390, height: 2 },
        { type: "box", x: 0, y: 0, xEnd: 390, yEnd: 190 },
      ],
    });
    expect(instructionCount).toBe(3);
  });

  it("renders the full documented example payload in the documented order", () => {
    const { buffer } = render({
      labelWidthMm: 50,
      labelHeightMm: 25,
      gapMm: 3,
      density: 8,
      speed: 4,
      direction: 1,
      referenceX: 0,
      referenceY: 0,
      instructions: [
        { type: "text", x: 20, y: 20, value: "Polo T-Shirt", font: "3", rotation: 0, xMultiplier: 1, yMultiplier: 1 },
        { type: "barcode", x: 20, y: 60, value: "8901234567890", symbology: "128", height: 60, humanReadable: true, rotation: 0, narrow: 2, wide: 2 },
        { type: "text", x: 20, y: 140, value: "MRP: 799", font: "3", rotation: 0, xMultiplier: 1, yMultiplier: 1 },
      ],
    });

    expect(buffer.toString("ascii")).toBe(
      [
        "SIZE 50 mm,25 mm",
        "GAP 3 mm,0 mm",
        "DENSITY 8",
        "SPEED 4",
        "DIRECTION 1",
        "REFERENCE 0,0",
        "CLS",
        'TEXT 20,20,"3",0,1,1,"Polo T-Shirt"',
        'BARCODE 20,60,"128",60,1,0,2,2,"8901234567890"',
        'TEXT 20,140,"3",0,1,1,"MRP: 799"',
        "PRINT 1",
        "",
      ].join("\r\n"),
    );
  });
});
