import express, { type Express } from "express";
import type { AppConfig } from "./config/config.schema";
import { errorHandler } from "./errors/error-handler";
import { createHealthRouter } from "./routes/health.routes";

export function createServer(config: AppConfig): Express {
  const app = express();

  app.use(express.json());

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
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

  app.use(createHealthRouter(() => config));

  app.use(errorHandler);

  return app;
}
