import { z } from "zod";

// Deliberately lenient on printRole/commandLanguage/payloadType: they must
// be non-empty strings here, but whether they're a *known* / *implemented*
// value is a business-rule decision made in print-job.service.ts, so it can
// return the more specific PRINT_ROLE_NOT_IMPLEMENTED / UNSUPPORTED_PAYLOAD_TYPE
// / UNSUPPORTED_COMMAND_LANGUAGE error codes instead of a generic schema
// failure for values the wider system recognizes but this endpoint doesn't
// implement yet.
export const PrintJobRequestSchema = z.object({
  jobId: z.string().min(1, "jobId is required"),
  printRole: z.string().min(1, "printRole is required"),
  commandLanguage: z.string().min(1, "commandLanguage is required"),
  payloadType: z.string().min(1, "payloadType is required"),
  copies: z
    .number()
    .int()
    .min(1, "copies must be between 1 and 5")
    .max(5, "copies must be between 1 and 5")
    .default(1),
  payload: z.unknown(),
});

export type PrintJobRequest = z.infer<typeof PrintJobRequestSchema>;
