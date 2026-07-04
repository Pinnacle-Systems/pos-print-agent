import type {
  TsplBarcodeInstruction,
  TsplBoxInstruction,
  TsplLabelInstruction,
  TsplLabelPayload,
  TsplLineInstruction,
  TsplTextInstruction,
} from "./tspl-label.schema";

export type {
  TsplBarcodeInstruction,
  TsplBoxInstruction,
  TsplLabelInstruction,
  TsplLabelPayload,
  TsplLineInstruction,
  TsplTextInstruction,
};

export interface RenderedTsplLabel {
  buffer: Buffer;
  instructionCount: number;
}
