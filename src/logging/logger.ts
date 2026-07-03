import fs from "node:fs";
import path from "node:path";
import { LOG_DIR_PATH } from "../config/config.paths";

type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, message: string): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }

  try {
    fs.appendFileSync(path.join(LOG_DIR_PATH, "agent.log"), `${line}\n`, "utf-8");
  } catch {
    // A logging failure must never crash the agent.
  }
}

export const logger = {
  info: (message: string) => write("info", message),
  warn: (message: string) => write("warn", message),
  error: (message: string) => write("error", message),
};
