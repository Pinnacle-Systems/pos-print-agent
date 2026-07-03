import { z } from "zod";
import { COMMAND_LANGUAGES } from "../print-jobs/print-role";

export const PrinterMappingSchema = z.object({
  windowsPrinterName: z.string().min(1, "windowsPrinterName is required"),
  template: z.string().min(1, "template is required"),
  commandLanguage: z.enum([...COMMAND_LANGUAGES]),
  paperWidth: z.string().optional(),
  labelWidth: z.string().optional(),
  labelHeight: z.string().optional(),
});

export type PrinterMapping = z.infer<typeof PrinterMappingSchema>;

export const PrinterMappingsSchema = z.record(z.string(), PrinterMappingSchema);

export type PrinterMappings = z.infer<typeof PrinterMappingsSchema>;

export const ConfigSchema = z.object({
  agentPort: z.number().int().positive().default(17777),
  machineCode: z.string().default(""),
  allowedOrigins: z
    .array(z.string())
    .default(["http://localhost:5173", "https://pos.yourdomain.com"]),
  printerMappings: PrinterMappingsSchema.default({}),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
