import { Router } from "express";
import os from "node:os";
import { isConfigured } from "../config/config.service";
import type { AppConfig } from "../config/config.schema";

const AGENT_NAME = "Pinnacle POS Print Agent";
const AGENT_VERSION = "1.0.0";

export function createHealthRouter(getConfig: () => AppConfig): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    const config = getConfig();

    res.json({
      status: "ok",
      agentName: AGENT_NAME,
      version: AGENT_VERSION,
      machineName: os.hostname() || "UNKNOWN",
      configured: isConfigured(config),
      printerMappings: config.printerMappings,
    });
  });

  return router;
}
