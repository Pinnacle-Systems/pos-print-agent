import type {
  BarcodeInstruction,
  BlankInstruction,
  CutInstruction,
  FeedInstruction,
  LeftRightInstruction,
  LineInstruction,
  OpenDrawerInstruction,
  PrintInstruction,
  PrintInstructionsPayload,
  QrInstruction,
  TextInstruction,
} from "./print-instruction.schema";

export type {
  BarcodeInstruction,
  BlankInstruction,
  CutInstruction,
  FeedInstruction,
  LeftRightInstruction,
  LineInstruction,
  OpenDrawerInstruction,
  PrintInstruction,
  PrintInstructionsPayload,
  QrInstruction,
  TextInstruction,
};

export interface RenderedEscPosPayload {
  buffer: Buffer;
  instructionCount: number;
}
