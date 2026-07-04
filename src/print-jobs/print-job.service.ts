import type { ZodIssue } from "zod";
import { getConfig } from "../config/config.service";
import { AppError } from "../errors/app-error";
import { logger } from "../logging/logger";
import { renderEscPosInstructions } from "../print-instructions/escpos-instruction.renderer";
import { KNOWN_INSTRUCTION_TYPES, PrintInstructionsPayloadSchema } from "../print-instructions/print-instruction.schema";
import { sendRawToPrinter } from "../printers/raw-print.service";
import { listPrinters } from "../printers/printer-discovery.service";
import { PrintJobRequestSchema } from "./print-job.schema";
import { isCommandLanguage, isPrintRole } from "./print-role";

// This prompt only implements the "receipt" role rendered as ESC_POS. Other
// PRINT_ROLES/COMMAND_LANGUAGES values are real, recognized concepts
// elsewhere in the system (see print-role.ts) - they are just not wired up
// to a renderer here yet, hence PRINT_ROLE_NOT_IMPLEMENTED /
// UNSUPPORTED_COMMAND_LANGUAGE rather than a generic validation failure.
const SUPPORTED_PAYLOAD_TYPE = "PRINT_INSTRUCTIONS";
const IMPLEMENTED_PRINT_ROLE = "receipt";
const IMPLEMENTED_COMMAND_LANGUAGE = "ESC_POS";

export interface PrintJobResult {
  jobId: string;
  printRole: string;
  commandLanguage: string;
  payloadType: string;
  printerName: string;
  copies: number;
  message: string;
}

function formatZodIssues(issues: ZodIssue[]): string {
  return issues
    .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}

/**
 * Rejects payload.instructions entries whose "type" isn't one of the
 * implemented instruction types, with a dedicated error code
 * (INSTRUCTION_TYPE_NOT_IMPLEMENTED) distinct from a malformed-but-known
 * instruction (which falls through to the Zod schema below and becomes
 * INVALID_PRINT_PAYLOAD). Runs before the full schema parse so an unknown
 * type is never misreported as a generic shape error.
 */
function assertKnownInstructionTypes(payload: unknown): void {
  if (typeof payload !== "object" || payload === null) {
    return;
  }

  const instructions = (payload as { instructions?: unknown }).instructions;
  if (!Array.isArray(instructions)) {
    return;
  }

  for (const instruction of instructions) {
    const type = typeof instruction === "object" && instruction !== null ? (instruction as { type?: unknown }).type : undefined;
    if (typeof type !== "string" || !(KNOWN_INSTRUCTION_TYPES as readonly string[]).includes(type)) {
      throw new AppError(
        400,
        "INSTRUCTION_TYPE_NOT_IMPLEMENTED",
        `Instruction type "${String(type)}" is not implemented. Supported types: ${KNOWN_INSTRUCTION_TYPES.join(", ")}`,
      );
    }
  }
}

function logPrintJob(fields: Record<string, unknown>): void {
  const line = JSON.stringify(fields);
  if (fields.success) {
    logger.info(line);
  } else {
    logger.error(line);
  }
}

/**
 * Converts a generic PRINT_INSTRUCTIONS payload into ESC/POS bytes and
 * sends it to the locally mapped Windows printer for printRole "receipt".
 * This function deliberately never inspects invoice-shaped fields (GST,
 * discounts, item rows, offers) - the caller (POS/backend) already reduced
 * all of that to the generic `instructions` array before this is called.
 */
export async function processPrintJob(rawBody: unknown): Promise<PrintJobResult> {
  const timestamp = new Date().toISOString();
  const bodyRecord = typeof rawBody === "object" && rawBody !== null ? (rawBody as Record<string, unknown>) : {};

  const logFields: Record<string, unknown> = {
    jobId: typeof bodyRecord.jobId === "string" ? bodyRecord.jobId : undefined,
    printRole: typeof bodyRecord.printRole === "string" ? bodyRecord.printRole : undefined,
    commandLanguage: typeof bodyRecord.commandLanguage === "string" ? bodyRecord.commandLanguage : undefined,
    payloadType: typeof bodyRecord.payloadType === "string" ? bodyRecord.payloadType : undefined,
    copies: typeof bodyRecord.copies === "number" ? bodyRecord.copies : undefined,
  };

  try {
    const envelopeParsed = PrintJobRequestSchema.safeParse(rawBody);
    if (!envelopeParsed.success) {
      throw new AppError(400, "INVALID_PRINT_PAYLOAD", formatZodIssues(envelopeParsed.error.issues));
    }

    const { jobId, printRole, commandLanguage, payloadType, copies, payload } = envelopeParsed.data;
    logFields.copies = copies;

    if (!isPrintRole(printRole)) {
      throw new AppError(400, "INVALID_PRINT_PAYLOAD", `Unsupported print role "${printRole}"`);
    }

    if (printRole !== IMPLEMENTED_PRINT_ROLE) {
      throw new AppError(
        400,
        "PRINT_ROLE_NOT_IMPLEMENTED",
        `Print role "${printRole}" is not implemented by POST /print yet. Only "${IMPLEMENTED_PRINT_ROLE}" is supported right now.`,
      );
    }

    if (!isCommandLanguage(commandLanguage)) {
      throw new AppError(400, "INVALID_PRINT_PAYLOAD", `Unsupported command language "${commandLanguage}"`);
    }

    if (payloadType !== SUPPORTED_PAYLOAD_TYPE) {
      throw new AppError(
        400,
        "UNSUPPORTED_PAYLOAD_TYPE",
        `payloadType "${payloadType}" is not supported by POST /print. Only "${SUPPORTED_PAYLOAD_TYPE}" is accepted.`,
      );
    }

    assertKnownInstructionTypes(payload);

    const payloadParsed = PrintInstructionsPayloadSchema.safeParse(payload);
    if (!payloadParsed.success) {
      throw new AppError(400, "INVALID_PRINT_PAYLOAD", formatZodIssues(payloadParsed.error.issues));
    }

    const config = getConfig();
    const mapping = config.printerMappings[printRole];
    if (!mapping) {
      throw new AppError(
        400,
        "PRINT_ROLE_NOT_CONFIGURED",
        `No printer is configured for role "${printRole}". Configure and save it on the setup page first.`,
      );
    }

    const installedPrinters = await listPrinters();
    const stillInstalled = installedPrinters.some((printer) => printer.name === mapping.windowsPrinterName);
    if (!stillInstalled) {
      throw new AppError(
        400,
        "WINDOWS_PRINTER_NOT_FOUND",
        `Configured printer "${mapping.windowsPrinterName}" for role "${printRole}" was not found on this machine. Call GET /printers to see what's installed.`,
      );
    }

    logFields.printerName = mapping.windowsPrinterName;

    if (mapping.commandLanguage !== commandLanguage || commandLanguage !== IMPLEMENTED_COMMAND_LANGUAGE) {
      throw new AppError(
        400,
        "UNSUPPORTED_COMMAND_LANGUAGE",
        `Requested commandLanguage "${commandLanguage}" does not match the "${printRole}" printer mapping's configured language ("${mapping.commandLanguage}").`,
      );
    }

    const { buffer, instructionCount } = renderEscPosInstructions(payloadParsed.data);
    logFields.instructionCount = instructionCount;
    logFields.renderedPayloadSizeBytes = buffer.length;

    for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
      const jobName = copies > 1 ? `${jobId}-copy-${copyIndex + 1}` : jobId;
      try {
        await sendRawToPrinter({ printerName: mapping.windowsPrinterName, jobName, data: buffer });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        throw new AppError(
          502,
          "PRINT_QUEUE_FAILED",
          `Failed to send copy ${copyIndex + 1}/${copies} to "${mapping.windowsPrinterName}": ${message}`,
        );
      }
    }

    logPrintJob({ ...logFields, success: true, timestamp });

    return {
      jobId,
      printRole,
      commandLanguage,
      payloadType,
      printerName: mapping.windowsPrinterName,
      copies,
      message: "Print instructions sent successfully",
    };
  } catch (err) {
    const errorCode = err instanceof AppError ? err.errorCode : "INTERNAL_ERROR";
    logPrintJob({ ...logFields, success: false, errorCode, timestamp });
    throw err;
  }
}
