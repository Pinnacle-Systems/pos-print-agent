import type { PrintInstruction, PrintInstructionsPayload } from "./print-instruction.schema";

export type { PrintInstruction, PrintInstructionsPayload };

export interface RenderedEscPosPayload {
  buffer: Buffer;
  instructionCount: number;
}
