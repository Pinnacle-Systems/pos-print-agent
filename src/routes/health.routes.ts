import { Router } from "express";
import os from "node:os";
import { getConfig, isConfigured } from "../config/config.service";
import { PRINT_ROLES } from "../print-jobs/print-role";

const AGENT_NAME = "Pinnacle POS Print Agent";
const AGENT_VERSION = "1.0.0";

interface PrintRoleHealth {
  configured: boolean;
  printerName?: string;
}

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    const config = getConfig();

    const printerMappings: Record<string, PrintRoleHealth> = {};
    for (const role of PRINT_ROLES) {
      const mapping = config.printerMappings[role];
      printerMappings[role] = mapping
        ? { configured: true, printerName: mapping.windowsPrinterName }
        : { configured: false };
    }

    res.json({
      status: "ok",
      agentName: AGENT_NAME,
      version: AGENT_VERSION,
      machineName: os.hostname() || "UNKNOWN",
      configured: isConfigured(config),
      printerMappings,
    });
  });

  return router;
}
