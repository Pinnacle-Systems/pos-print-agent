import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "../errors/app-error";
import { logger } from "../logging/logger";
import { resolveSumatraPdfPath } from "./pdf-tool-path.service";

const execFileAsync = promisify(execFile);

export interface PdfPrintRequest {
  printerName: string;
  pdfFilePath: string;
  copies: number;
  jobId: string;
}

export interface PdfPrintResult {
  success: true;
  printerName: string;
  sumatraPdfPath: string;
}

/**
 * Prints a PDF file via SumatraPDF's silent print mode
 * (`-print-to <printer> -silent <file>`), invoked with an argument array
 * (never a shell string) so printer names/paths can't be interpreted as
 * shell syntax. This is a separate, PDF-aware path from
 * sendRawToPrinter() in raw-print.service.ts: that function writes raw
 * ESC/POS/TSPL bytes straight to the spooler's RAW datatype, which a normal
 * A4 printer driver does not accept as PDF input - see README "Why PDF uses
 * a separate path from raw ESC/POS".
 */
export async function printPdfFile(request: PdfPrintRequest): Promise<PdfPrintResult> {
  const { printerName, pdfFilePath, copies, jobId } = request;

  if (process.platform !== "win32") {
    // No Windows print spooler or SumatraPDF binary to run outside Windows;
    // treat as a no-op success so routes/tests can still exercise this path
    // locally, matching the fallback pattern in raw-print.service.ts.
    logger.info(`[dev mock] Would print "${pdfFilePath}" (${copies} copy/copies) to "${printerName}" via SumatraPDF.`);
    return { success: true, printerName, sumatraPdfPath: "(dev mock)" };
  }

  const sumatraPdfPath = resolveSumatraPdfPath();
  if (!sumatraPdfPath) {
    throw new AppError(
      500,
      "PDF_PRINT_TOOL_NOT_FOUND",
      "SumatraPDF.exe was not found. Place it beside PosPrintAgent.exe (packaged deployment) or at tools/SumatraPDF.exe (development) - see README 'SumatraPDF requirement'.",
    );
  }

  for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
    try {
      await execFileAsync(sumatraPdfPath, ["-print-to", printerName, "-silent", pdfFilePath], {
        windowsHide: true,
        timeout: 30_000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(
        `PDF print (jobId=${jobId}, copy ${copyIndex + 1}/${copies}) to "${printerName}" failed: ${message}`,
      );
      throw new AppError(
        502,
        "PDF_PRINT_FAILED",
        `SumatraPDF failed to print copy ${copyIndex + 1}/${copies} to "${printerName}": ${message}`,
      );
    }
  }

  return { success: true, printerName, sumatraPdfPath };
}
