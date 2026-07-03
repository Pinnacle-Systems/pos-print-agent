import fs from "node:fs";
import { CONFIG_FILE_PATH, DATA_ROOT, LOG_DIR_PATH } from "./config.paths";
import { ConfigSchema, type AppConfig } from "./config.schema";

const DEFAULT_CONFIG: AppConfig = {
  agentPort: 17777,
  machineCode: "",
  allowedOrigins: ["http://localhost:5173", "https://pos.yourdomain.com"],
  printerMappings: {},
};

export function ensureDirectories(): void {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.mkdirSync(LOG_DIR_PATH, { recursive: true });
}

export function loadConfig(): AppConfig {
  ensureDirectories();

  if (!fs.existsSync(CONFIG_FILE_PATH)) {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
    return DEFAULT_CONFIG;
  }

  const raw = fs.readFileSync(CONFIG_FILE_PATH, "utf-8");
  return ConfigSchema.parse(JSON.parse(raw));
}

export function isConfigured(config: AppConfig): boolean {
  return config.machineCode.trim().length > 0 && Object.keys(config.printerMappings).length > 0;
}
