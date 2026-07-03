export const PRINT_ROLES = ["receipt", "barcode-label", "a4-invoice", "cash-drawer"] as const;
export type PrintRole = (typeof PRINT_ROLES)[number];

export const COMMAND_LANGUAGES = ["ESC_POS", "TSPL", "ZPL", "PDF", "WINDOWS_DRIVER"] as const;
export type CommandLanguage = (typeof COMMAND_LANGUAGES)[number];

export const ALLOWED_COMMAND_LANGUAGES_BY_ROLE: Record<PrintRole, readonly CommandLanguage[]> = {
  receipt: ["ESC_POS", "WINDOWS_DRIVER"],
  "barcode-label": ["TSPL", "ZPL", "WINDOWS_DRIVER"],
  "a4-invoice": ["PDF", "WINDOWS_DRIVER"],
  "cash-drawer": ["ESC_POS"],
};

export function isPrintRole(value: string): value is PrintRole {
  return (PRINT_ROLES as readonly string[]).includes(value);
}

export function isCommandLanguage(value: string): value is CommandLanguage {
  return (COMMAND_LANGUAGES as readonly string[]).includes(value);
}

export function isCommandLanguageAllowedForRole(role: PrintRole, language: CommandLanguage): boolean {
  return ALLOWED_COMMAND_LANGUAGES_BY_ROLE[role].includes(language);
}
