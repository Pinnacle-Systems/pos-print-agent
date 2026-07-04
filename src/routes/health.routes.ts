import { Router } from "express";
import os from "node:os";
import { AGENT_NAME } from "../agent-info";
import { DATA_ROOT, LOG_DIR_PATH, TEMP_DIR_PATH } from "../config/config.paths";
import { getConfig, isConfigured } from "../config/config.service";
import { PRINT_CAPABILITIES } from "../print-jobs/print-capabilities";
import { PRINT_ROLES } from "../print-jobs/print-role";
import { listPrinters } from "../printers/printer-discovery.service";
import { BUILD_INFO } from "../version-info";

interface PrintRoleHealth {
  configured: boolean;
  printerName?: string;
  commandLanguage?: string;
  printerInstalled?: boolean;
}

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/health", async (_req, res) => {
    const config = getConfig();

    // Printer discovery failing (e.g. the WMI/PowerShell call errors out)
    // must not take /health down - printerInstalled is simply omitted for
    // every role in that case rather than the endpoint 500ing.
    let installedNames: Set<string> | null = null;
    try {
      const printers = await listPrinters();
      installedNames = new Set(printers.map((printer) => printer.name));
    } catch {
      installedNames = null;
    }

    const printerMappings: Record<string, PrintRoleHealth> = {};
    for (const role of PRINT_ROLES) {
      const mapping = config.printerMappings[role];
      if (!mapping) {
        printerMappings[role] = { configured: false };
        continue;
      }

      printerMappings[role] = {
        configured: true,
        printerName: mapping.windowsPrinterName,
        commandLanguage: mapping.commandLanguage,
        ...(installedNames ? { printerInstalled: installedNames.has(mapping.windowsPrinterName) } : {}),
      };
    }

    res.json({
      status: "ok",
      agentName: AGENT_NAME,
      version: BUILD_INFO.version,
      machineName: os.hostname() || "UNKNOWN",
      configured: isConfigured(config),
      paths: {
        configDir: DATA_ROOT,
        logDir: LOG_DIR_PATH,
        tempDir: TEMP_DIR_PATH,
      },
      capabilities: PRINT_CAPABILITIES,
      printerMappings,
    });
  });

  return router;
}
