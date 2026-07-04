import type { ZodIssue } from "zod";
import type { PrinterMapping } from "../config/config.schema";
import { getConfig } from "../config/config.service";
import { AppError } from "../errors/app-error";
import { logger } from "../logging/logger";
import { decodeBase64Pdf, hasPdfHeader, isLikelyBase64, MAX_PDF_SIZE_BYTES, PDF_PAYLOAD_ENCODING } from "../pdf/pdf-payload.schema";
import { printPdfFile } from "../pdf/pdf-print.service";
import { renderEscPosInstructions } from "../print-instructions/escpos-instruction.renderer";
import { KNOWN_INSTRUCTION_TYPES, PrintInstructionsPayloadSchema } from "../print-instructions/print-instruction.schema";
import { listPrinters } from "../printers/printer-discovery.service";
import { sendRawToPrinter } from "../printers/raw-print.service";
import { buildTempPdfFilePath, deleteTempFileBestEffort, writeTempFile } from "../temp/temp-file.service";
import { PrintJobRequestSchema } from "./print-job.schema";
import { isCommandLanguage, isPrintRole, type CommandLanguage, type PrintRole } from "./print-role";

// This prompt implements exactly two printRole/commandLanguage/payloadType
// combinations. Other PRINT_ROLES/COMMAND_LANGUAGES values are real,
// recognized concepts elsewhere in the system (see print-role.ts) - they
// are just not wired up to a renderer here yet, hence
// PRINT_ROLE_NOT_IMPLEMENTED / UNSUPPORTED_COMMAND_LANGUAGE rather than a
// generic validation failure.
const RECEIPT_PAYLOAD_TYPE = "PRINT_INSTRUCTIONS";
const RECEIPT_PRINT_ROLE: PrintRole = "receipt";
const RECEIPT_COMMAND_LANGUAGE: CommandLanguage = "ESC_POS";

const PDF_PAYLOAD_TYPE = "PDF";
const PDF_PRINT_ROLE: PrintRole = "a4-invoice";
const PDF_COMMAND_LANGUAGE: CommandLanguage = "PDF";

export interface PrintJobResult {
  jobId: string;
  printRole: string;
  commandLanguage: string;
  payloadType: string;
  printerName: string;
  copies: number;
  message: string;
}

interface ParsedPrintJobRequest {
  jobId: string;
  printRole: PrintRole;
  commandLanguage: CommandLanguage;
  payloadType: string;
  payloadEncoding: string | undefined;
  copies: number;
  payload: unknown;
}

function formatZodIssues(issues: ZodIssue[]): string {
  return issues
    .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}

function resolvePrinterMapping(printRole: PrintRole): PrinterMapping {
  const config = getConfig();
  const mapping = config.printerMappings[printRole];
  if (!mapping) {
    throw new AppError(
      400,
      "PRINT_ROLE_NOT_CONFIGURED",
      `No printer is configured for role "${printRole}". Configure and save it on the setup page first.`,
    );
  }
  return mapping;
}

async function assertPrinterInstalled(printRole: PrintRole, mapping: PrinterMapping): Promise<void> {
  const installedPrinters = await listPrinters();
  const stillInstalled = installedPrinters.some((printer) => printer.name === mapping.windowsPrinterName);
  if (!stillInstalled) {
    throw new AppError(
      400,
      "WINDOWS_PRINTER_NOT_FOUND",
      `Configured printer "${mapping.windowsPrinterName}" for role "${printRole}" was not found on this machine. Call GET /printers to see what's installed.`,
    );
  }
}

function assertCommandLanguageMatches(
  printRole: PrintRole,
  mapping: PrinterMapping,
  requested: CommandLanguage,
  implemented: CommandLanguage,
): void {
  if (mapping.commandLanguage !== requested || requested !== implemented) {
    throw new AppError(
      400,
      "UNSUPPORTED_COMMAND_LANGUAGE",
      `Requested commandLanguage "${requested}" does not match the "${printRole}" printer mapping's configured language ("${mapping.commandLanguage}").`,
    );
  }
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
async function processReceiptInstructionsJob(
  request: ParsedPrintJobRequest,
  logFields: Record<string, unknown>,
): Promise<PrintJobResult> {
  const { jobId, printRole, commandLanguage, payloadType, copies, payload } = request;

  if (printRole !== RECEIPT_PRINT_ROLE) {
    throw new AppError(
      400,
      "PRINT_ROLE_NOT_IMPLEMENTED",
      `payloadType "${RECEIPT_PAYLOAD_TYPE}" is only implemented for print role "${RECEIPT_PRINT_ROLE}", not "${printRole}".`,
    );
  }

  assertKnownInstructionTypes(payload);

  const payloadParsed = PrintInstructionsPayloadSchema.safeParse(payload);
  if (!payloadParsed.success) {
    throw new AppError(400, "INVALID_PRINT_PAYLOAD", formatZodIssues(payloadParsed.error.issues));
  }

  const mapping = resolvePrinterMapping(printRole);
  await assertPrinterInstalled(printRole, mapping);
  logFields.printerName = mapping.windowsPrinterName;
  assertCommandLanguageMatches(printRole, mapping, commandLanguage, RECEIPT_COMMAND_LANGUAGE);

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

  return {
    jobId,
    printRole,
    commandLanguage,
    payloadType,
    printerName: mapping.windowsPrinterName,
    copies,
    message: "Print instructions sent successfully",
  };
}

/**
 * Decodes a base64 PDF payload and sends it to the locally mapped Windows
 * printer for printRole "a4-invoice" via SumatraPDF. This function never
 * generates or understands invoice layout, GST, tax, discounts, or item
 * logic - POS/backend already rendered the final PDF bytes before this is
 * called. Deliberately does not reuse sendRawToPrinter(): a normal A4
 * printer driver does not accept raw PDF bytes through WritePrinter, so PDF
 * needs its own PDF-aware print path (see README "Why PDF uses a separate
 * path from raw ESC/POS").
 */
async function processPdfJob(request: ParsedPrintJobRequest, logFields: Record<string, unknown>): Promise<PrintJobResult> {
  const { jobId, printRole, commandLanguage, payloadType, payloadEncoding, copies, payload } = request;

  if (printRole !== PDF_PRINT_ROLE) {
    throw new AppError(
      400,
      "PRINT_ROLE_NOT_IMPLEMENTED",
      `payloadType "${PDF_PAYLOAD_TYPE}" is only implemented for print role "${PDF_PRINT_ROLE}", not "${printRole}".`,
    );
  }

  if (payloadEncoding !== PDF_PAYLOAD_ENCODING) {
    throw new AppError(
      400,
      "UNSUPPORTED_PAYLOAD_ENCODING",
      `payloadEncoding "${payloadEncoding}" is not supported. Only "${PDF_PAYLOAD_ENCODING}" is accepted.`,
    );
  }

  if (typeof payload !== "string" || payload.trim().length === 0) {
    throw new AppError(400, "INVALID_PRINT_PAYLOAD", "payload is required and must be a base64-encoded string for payloadType \"PDF\".");
  }

  if (!isLikelyBase64(payload)) {
    throw new AppError(400, "PDF_DECODE_FAILED", "payload could not be decoded as base64.");
  }

  const pdfBuffer = decodeBase64Pdf(payload);
  if (pdfBuffer.length === 0) {
    throw new AppError(400, "INVALID_PDF_PAYLOAD", "Decoded PDF payload is empty.");
  }

  if (!hasPdfHeader(pdfBuffer)) {
    throw new AppError(400, "INVALID_PDF_PAYLOAD", "Decoded payload does not start with the PDF header (%PDF).");
  }

  if (pdfBuffer.length > MAX_PDF_SIZE_BYTES) {
    throw new AppError(400, "PDF_PAYLOAD_TOO_LARGE", `Decoded PDF exceeds the ${MAX_PDF_SIZE_BYTES}-byte limit.`);
  }

  logFields.pdfSizeBytes = pdfBuffer.length;

  const mapping = resolvePrinterMapping(printRole);
  await assertPrinterInstalled(printRole, mapping);
  logFields.printerName = mapping.windowsPrinterName;
  assertCommandLanguageMatches(printRole, mapping, commandLanguage, PDF_COMMAND_LANGUAGE);

  const tempFilePath = buildTempPdfFilePath(jobId);
  logFields.tempFilePath = tempFilePath;

  try {
    writeTempFile(tempFilePath, pdfBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new AppError(500, "TEMP_FILE_WRITE_FAILED", `Failed to write temp PDF file: ${message}`);
  }

  try {
    await printPdfFile({ printerName: mapping.windowsPrinterName, pdfFilePath: tempFilePath, copies, jobId });
  } finally {
    // Best-effort cleanup either way - see temp-file.service.ts. A failure
    // to delete must never fail a print job that already reached the
    // printer/spooler successfully.
    deleteTempFileBestEffort(tempFilePath);
  }

  return {
    jobId,
    printRole,
    commandLanguage,
    payloadType,
    printerName: mapping.windowsPrinterName,
    copies,
    message: "PDF print job sent successfully",
  };
}

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

    const { jobId, printRole, commandLanguage, payloadType, payloadEncoding, copies, payload } = envelopeParsed.data;
    logFields.copies = copies;

    if (!isPrintRole(printRole)) {
      throw new AppError(400, "INVALID_PRINT_PAYLOAD", `Unsupported print role "${printRole}"`);
    }

    if (!isCommandLanguage(commandLanguage)) {
      throw new AppError(400, "INVALID_PRINT_PAYLOAD", `Unsupported command language "${commandLanguage}"`);
    }

    const parsedRequest: ParsedPrintJobRequest = {
      jobId,
      printRole,
      commandLanguage,
      payloadType,
      payloadEncoding,
      copies,
      payload,
    };

    let result: PrintJobResult;
    if (payloadType === RECEIPT_PAYLOAD_TYPE) {
      result = await processReceiptInstructionsJob(parsedRequest, logFields);
    } else if (payloadType === PDF_PAYLOAD_TYPE) {
      result = await processPdfJob(parsedRequest, logFields);
    } else {
      throw new AppError(
        400,
        "UNSUPPORTED_PAYLOAD_TYPE",
        `payloadType "${payloadType}" is not supported by POST /print. Supported: ${RECEIPT_PAYLOAD_TYPE}, ${PDF_PAYLOAD_TYPE}.`,
      );
    }

    logPrintJob({ ...logFields, success: true, timestamp });
    return result;
  } catch (err) {
    const errorCode = err instanceof AppError ? err.errorCode : "INTERNAL_ERROR";
    logPrintJob({ ...logFields, success: false, errorCode, timestamp });
    throw err;
  }
}
