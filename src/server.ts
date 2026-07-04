import express, { type Express } from "express";
import { getConfig } from "./config/config.service";
import { errorHandler } from "./errors/error-handler";
import { createConfigRouter } from "./routes/config.routes";
import { createDiagnosticsRouter } from "./routes/diagnostics.routes";
import { createHealthRouter } from "./routes/health.routes";
import { createPrintersRouter } from "./routes/printers.routes";
import { createPrintRouter } from "./routes/print.routes";
import { createSetupRouter } from "./routes/setup.routes";
import { createTestPrintRouter } from "./routes/test-print.routes";
import { createVersionRouter } from "./routes/version.routes";

export function createServer(): Express {
  const app = express();

  app.use(express.json());

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const { allowedOrigins } = getConfig();
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(createHealthRouter());
  app.use(createVersionRouter());
  app.use(createPrintersRouter());
  app.use(createConfigRouter());
  app.use(createSetupRouter());
  app.use(createTestPrintRouter());
  app.use(createPrintRouter());
  app.use(createDiagnosticsRouter());

  app.use(errorHandler);

  return app;
}
