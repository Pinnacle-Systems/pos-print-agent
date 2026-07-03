import fs from "node:fs";
import { CONFIG_FILE_PATH, DATA_ROOT, LOG_DIR_PATH } from "./config.paths";
import { ConfigSchema, type AppConfig, type PrinterMappings } from "./config.schema";

const DEFAULT_CONFIG: AppConfig = {
  agentPort: 17777,
  machineCode: "",
  allowedOrigins: ["http://localhost:5173", "https://pos.yourdomain.com"],
  printerMappings: {},
};

// Cached so every route reads/writes the same in-memory config instead of
// re-reading the file on every request, while still staying in sync with
// the file after saveConfig()/updatePrinterMappings().
let cachedConfig: AppConfig | null = null;

export function ensureDirectories(): void {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.mkdirSync(LOG_DIR_PATH, { recursive: true });
}

export function loadConfig(): AppConfig {
  ensureDirectories();

  if (!fs.existsSync(CONFIG_FILE_PATH)) {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }

  const raw = fs.readFileSync(CONFIG_FILE_PATH, "utf-8");
  cachedConfig = ConfigSchema.parse(JSON.parse(raw));
  return cachedConfig;
}

export function getConfig(): AppConfig {
  return cachedConfig ?? loadConfig();
}

export function saveConfig(config: AppConfig): AppConfig {
  const validated = ConfigSchema.parse(config);
  ensureDirectories();
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(validated, null, 2), "utf-8");
  cachedConfig = validated;
  return cachedConfig;
}

export function updatePrinterMappings(printerMappings: PrinterMappings): AppConfig {
  return saveConfig({ ...getConfig(), printerMappings });
}

export function isConfigured(config: AppConfig): boolean {
  return config.machineCode.trim().length > 0 && Object.keys(config.printerMappings).length > 0;
}
