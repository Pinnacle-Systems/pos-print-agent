import type {
  BlankInstruction,
  CutInstruction,
  FeedInstruction,
  LeftRightInstruction,
  LineInstruction,
  OpenDrawerInstruction,
  PrintInstruction,
  PrintInstructionsPayload,
  TextInstruction,
} from "./print-instruction.schema";

export type {
  BlankInstruction,
  CutInstruction,
  FeedInstruction,
  LeftRightInstruction,
  LineInstruction,
  OpenDrawerInstruction,
  PrintInstruction,
  PrintInstructionsPayload,
  TextInstruction,
};

export interface RenderedEscPosPayload {
  buffer: Buffer;
  instructionCount: number;
}
