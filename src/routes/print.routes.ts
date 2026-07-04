import { Router } from "express";
import { processPrintJob } from "../print-jobs/print-job.service";

// POST /print is the only public print entry point. It supports two
// payload shapes - PRINT_INSTRUCTIONS (receipt, converted to ESC/POS) and
// PDF (a4-invoice, sent through the PDF-aware adapter) - and never accepts
// invoice JSON or raw command bytes directly. See README "Dumb bridge plus
// print-instruction design" and "Why PDF uses a separate path from raw
// ESC/POS".
export function createPrintRouter(): Router {
  const router = Router();

  router.post("/print", async (req, res, next) => {
    try {
      const result = await processPrintJob(req.body);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
