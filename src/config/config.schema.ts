import { z } from "zod";

export const ConfigSchema = z.object({
  agentPort: z.number().int().positive().default(17777),
  machineCode: z.string().default(""),
  allowedOrigins: z
    .array(z.string())
    .default(["http://localhost:5173", "https://pos.yourdomain.com"]),
  printerMappings: z.record(z.string()).default({}),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
