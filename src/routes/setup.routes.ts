import express, { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../logging/logger";

// The setup page ships as plain static files (src/setup-ui) rather than a
// bundled frontend. In dev (tsx) and after `tsc` build, those files live
// one directory up from this compiled route file. When packaged with pkg,
// this file runs from inside a virtual snapshot filesystem, so instead the
// static files are copied beside the exe by scripts/prepare-windows-release.js
// and read from real disk relative to the exe's location.
function resolveSetupUiDir(): string {
  const isPackaged = Boolean((process as unknown as { pkg?: unknown }).pkg);
  if (isPackaged) {
    return path.join(path.dirname(process.execPath), "setup-ui");
  }
  return path.join(__dirname, "..", "setup-ui");
}

export function createSetupRouter(): Router {
  const router = Router();
  const setupUiDir = resolveSetupUiDir();

  if (!fs.existsSync(setupUiDir)) {
    logger.error(`Setup UI assets not found at ${setupUiDir}. GET /setup will 500 until they are present.`);
    router.get("/setup", (_req, res) => {
      res.status(500).json({
        success: false,
        errorCode: "SETUP_UI_ASSETS_MISSING",
        message: `Setup UI assets not found at ${setupUiDir}.`,
      });
    });
    return router;
  }

  router.use("/setup", express.static(setupUiDir));

  return router;
}
