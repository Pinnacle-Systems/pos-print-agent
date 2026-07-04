import fs from "node:fs";
import path from "node:path";
import { TEMP_DIR_PATH } from "../config/config.paths";
import { logger } from "../logging/logger";

export function ensureTempDir(): void {
  fs.mkdirSync(TEMP_DIR_PATH, { recursive: true });
}

// jobId comes from the caller (POS/backend) and is used verbatim in a
// filename below - strip anything that isn't alphanumeric/dash/underscore
// so it can't escape the temp directory (e.g. "../../evil") or produce an
// invalid Windows filename.
export function sanitizeJobIdForFilename(jobId: string): string {
  const sanitized = jobId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return sanitized.length > 0 ? sanitized : "job";
}

export function buildTempPdfFilePath(jobId: string): string {
  ensureTempDir();
  const safeJobId = sanitizeJobIdForFilename(jobId);
  const fileName = `print-${safeJobId}-${Date.now()}.pdf`;
  return path.join(TEMP_DIR_PATH, fileName);
}

export function writeTempFile(filePath: string, data: Buffer): void {
  fs.writeFileSync(filePath, data);
}

/**
 * Best-effort cleanup - a failure here must never fail the print response
 * for a job that already printed successfully, so this only logs a
 * warning rather than throwing.
 */
export function deleteTempFileBestEffort(filePath: string): void {
  fs.promises.rm(filePath, { force: true }).catch((err) => {
    logger.warn(`Failed to delete temp file ${filePath}: ${err instanceof Error ? err.message : "Unknown error"}`);
  });
}
