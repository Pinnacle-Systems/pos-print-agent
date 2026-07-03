import { AppError } from "../errors/app-error";
import { PrinterMappingSchema, type PrinterMappings } from "../config/config.schema";
import { ALLOWED_COMMAND_LANGUAGES_BY_ROLE, PRINT_ROLES, isPrintRole } from "../print-jobs/print-role";
import { listPrinters } from "./printer-discovery.service";

export async function validatePrinterMappings(rawInput: unknown): Promise<PrinterMappings> {
  if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
    throw new AppError(
      400,
      "INVALID_CONFIG_PAYLOAD",
      "printerMappings must be an object keyed by print role",
    );
  }

  const entries = Object.entries(rawInput as Record<string, unknown>);
  const discoveredPrinters = await listPrinters();
  const discoveredNames = new Set(discoveredPrinters.map((printer) => printer.name));

  const validated: PrinterMappings = {};

  for (const [role, rawMapping] of entries) {
    if (!isPrintRole(role)) {
      throw new AppError(
        400,
        "INVALID_PRINT_ROLE",
        `Unsupported print role "${role}". Supported roles: ${PRINT_ROLES.join(", ")}`,
      );
    }

    const parsed = PrinterMappingSchema.safeParse(rawMapping);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => issue.message).join("; ");
      throw new AppError(400, "INVALID_PRINTER_MAPPING", `Invalid mapping for role "${role}": ${details}`);
    }

    const mapping = parsed.data;
    const allowedLanguages = ALLOWED_COMMAND_LANGUAGES_BY_ROLE[role];
    if (!allowedLanguages.includes(mapping.commandLanguage)) {
      throw new AppError(
        400,
        "UNSUPPORTED_COMMAND_LANGUAGE_FOR_ROLE",
        `Role "${role}" does not support command language "${mapping.commandLanguage}". Allowed: ${allowedLanguages.join(", ")}`,
      );
    }

    if (!discoveredNames.has(mapping.windowsPrinterName)) {
      throw new AppError(
        400,
        "PRINTER_NOT_FOUND",
        `Windows printer "${mapping.windowsPrinterName}" was not found on this machine. Call GET /printers for installed printers.`,
      );
    }

    validated[role] = mapping;
  }

  return validated;
}
