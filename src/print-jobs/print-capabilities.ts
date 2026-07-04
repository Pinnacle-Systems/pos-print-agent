import type { CommandLanguage, PrintRole } from "./print-role";

export interface PrintRoleCapability {
  supported: boolean;
  commandLanguages?: readonly CommandLanguage[];
  payloadTypes?: readonly string[];
  note?: string;
}

// Mirrors exactly what POST /print currently implements (see the
// payloadType/printRole dispatch in print-job.service.ts) - kept as its own
// small, explicit descriptor so GET /health can report capabilities without
// print-job.service.ts needing to export its internal dispatch constants.
// Update this alongside print-job.service.ts whenever a new
// printRole/commandLanguage/payloadType combination is implemented.
export const PRINT_CAPABILITIES: Record<PrintRole, PrintRoleCapability> = {
  receipt: {
    supported: true,
    commandLanguages: ["ESC_POS"],
    payloadTypes: ["PRINT_INSTRUCTIONS"],
  },
  "barcode-label": {
    supported: true,
    commandLanguages: ["TSPL"],
    payloadTypes: ["PRINT_INSTRUCTIONS"],
  },
  "a4-invoice": {
    supported: true,
    commandLanguages: ["PDF"],
    payloadTypes: ["PDF"],
  },
  "cash-drawer": {
    supported: false,
    note: "Use receipt PRINT_INSTRUCTIONS openDrawer instruction for now",
  },
};
