import type { NextFunction, Request, Response } from "express";
import { logger } from "../logging/logger";
import { AppError } from "./app-error";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      errorCode: err.errorCode,
      message: err.message,
    });
    return;
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  logger.error(`Unhandled error: ${message}`);

  res.status(500).json({
    success: false,
    errorCode: "INTERNAL_ERROR",
    message: "Something went wrong",
  });
}
