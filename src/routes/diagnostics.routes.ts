import { Router } from "express";
import { getConfig } from "../config/config.service";
import { AppError } from "../errors/app-error";
import { logger } from "../logging/logger";
import { isPrintRole, PRINT_ROLES } from "../print-jobs/print-role";
import { listPrinters } from "../printers/printer-discovery.service";
import { sendRawToPrinter } from "../printers/raw-print.service";

// "escpos-text" is the only mode this spike needs (see acceptance criteria
// in the raw print adapter prompt). Adding a "tspl-label"/"zpl-label" mode
// later is just another buildXxxTestBuffer() + entry in this array - the
// raw print adapter itself is payload-agnostic.
const SUPPORTED_MODES = ["escpos-text"] as const;
type DiagnosticMode = (typeof SUPPORTED_MODES)[number];

function isSupportedMode(value: unknown): value is DiagnosticMode {
  return typeof value === "string" && (SUPPORTED_MODES as readonly string[]).includes(value);
}

const ESC = 0x1b;
const GS = 0x1d;

// Initialize -> print a line of text -> feed past the cutter -> cut. This
// is deliberately tiny: it exists to prove raw ESC_POS bytes reach the
// printer unmangled, not to render a real receipt.
function buildEscPosTestBuffer(): Buffer {
  const init = Buffer.from([ESC, 0x40]); // ESC @ - initialize printer
  const text = Buffer.from(`RAW PRINT TEST\n${new Date().toISOString()}\n`, "ascii");
  const feed = Buffer.from([0x0a, 0x0a, 0x0a, 0x0a]);
  const cut = Buffer.from([GS, 0x56, 0x00]); // GS V 0 - full cut
  return Buffer.concat([init, text, feed, cut]);
}

// This endpoint is a development/support diagnostic only - it is not part
// of the web POS integration and must never be called by it (see
// README.md "Raw Printing Diagnostic").
export function createDiagnosticsRouter(): Router {
  const router = Router();

  router.post("/diagnostics/raw-print", async (req, res, next) => {
    try {
      const { printRole, mode } = req.body ?? {};

      if (typeof printRole !== "string" || !isPrintRole(printRole)) {
        throw new AppError(
          400,
          "INVALID_PRINT_ROLE",
          `Body must include a "printRole" of: ${PRINT_ROLES.join(", ")}`,
        );
      }

      if (!isSupportedMode(mode)) {
        throw new AppError(
          400,
          "UNSUPPORTED_RAW_PRINT_MODE",
          `Unsupported mode "${mode}". Supported modes: ${SUPPORTED_MODES.join(", ")}`,
        );
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
          "PRINTER_NOT_FOUND",
          `Configured printer "${mapping.windowsPrinterName}" for role "${printRole}" was not found on this machine. Call GET /printers to see what's installed.`,
        );
      }

      const data = buildEscPosTestBuffer();
      const jobName = `pos-print-agent-diagnostics-${printRole}-${Date.now()}`;

      const result = await sendRawToPrinter({ printerName: mapping.windowsPrinterName, jobName, data });

      logger.info(
        `Raw print diagnostic sent to "${result.printerName}" for role "${printRole}" (mode "${mode}").`,
      );

      res.json({
        success: true,
        printRole,
        mode,
        printerName: result.printerName,
        jobName: result.jobName,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
