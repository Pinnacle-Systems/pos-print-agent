import { Router } from "express";
import { AppError } from "../errors/app-error";
import { isPrintRole, PRINT_ROLES } from "../print-jobs/print-role";
import { sendTestPrint } from "../print-jobs/test-print.service";

export function createTestPrintRouter(): Router {
  const router = Router();

  router.post("/test-print", async (req, res, next) => {
    try {
      const role = req.body?.role;

      if (typeof role !== "string" || !isPrintRole(role)) {
        throw new AppError(
          400,
          "INVALID_PRINT_ROLE",
          `Body must include a "role" of: ${PRINT_ROLES.join(", ")}`,
        );
      }

      const result = await sendTestPrint(role);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
