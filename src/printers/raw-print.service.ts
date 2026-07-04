import { AppError } from "../errors/app-error";
import { logger } from "../logging/logger";
import type { RawPrintRequest, RawPrintResult } from "./raw-print.types";
import { sendRawViaWindowsSpooler } from "./windows-print.service";

/**
 * Sends raw bytes (ESC/POS, TSPL, ZPL, ...) straight to a Windows print
 * queue, bypassing the GDI text pipeline that POST /test-print's
 * `Out-Printer` call goes through. This is the only supported entry point
 * for raw print delivery in this codebase - routes and other services must
 * call sendRawToPrinter() rather than reaching into windows-print.service.ts
 * or shelling out to PowerShell themselves, so the underlying mechanism can
 * be swapped (e.g. for a native addon) without touching call sites.
 */
export async function sendRawToPrinter(request: RawPrintRequest): Promise<RawPrintResult> {
  const { printerName, jobName, data } = request;

  if (process.platform !== "win32") {
    // No Windows print spooler to talk to outside Windows; treat as a
    // no-op success so routes/tests can still exercise this path locally,
    // matching the fallback pattern in printer-discovery.service.ts.
    logger.info(
      `[dev mock] Would send ${data.length} raw byte(s) to "${printerName}" (job "${jobName}").`,
    );
    return { success: true, printerName, jobName };
  }

  try {
    await sendRawViaWindowsSpooler(printerName, jobName, data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error(`Raw print to "${printerName}" (job "${jobName}") failed: ${message}`);
    throw new AppError(502, "RAW_PRINT_FAILED", `Raw print to "${printerName}" failed: ${message}`);
  }

  return { success: true, printerName, jobName };
}
