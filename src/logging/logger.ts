import fs from "node:fs";
import path from "node:path";
import { LOG_DIR_PATH } from "../config/config.paths";

type LogLevel = "info" | "warn" | "error";

const LOG_FILE_PATH = path.join(LOG_DIR_PATH, "agent.log");
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_ROTATED_FILES = 10;

function rotateIfNeeded(): void {
  let size: number;
  try {
    size = fs.statSync(LOG_FILE_PATH).size;
  } catch {
    return;
  }
  if (size < MAX_LOG_SIZE_BYTES) return;

  try {
    fs.rmSync(`${LOG_FILE_PATH}.${MAX_ROTATED_FILES}`, { force: true });
  } catch {
    // ignore
  }
  for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
    try {
      fs.renameSync(`${LOG_FILE_PATH}.${i}`, `${LOG_FILE_PATH}.${i + 1}`);
    } catch {
      // ignore missing rotated file
    }
  }
  try {
    fs.renameSync(LOG_FILE_PATH, `${LOG_FILE_PATH}.1`);
  } catch {
    // ignore
  }
}

function write(level: LogLevel, message: string): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }

  try {
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE_PATH, `${line}\n`, "utf-8");
  } catch {
    // A logging failure must never crash the agent.
  }
}

export const logger = {
  info: (message: string) => write("info", message),
  warn: (message: string) => write("warn", message),
  error: (message: string) => write("error", message),
};
