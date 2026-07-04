import { Router } from "express";
import { processPrintJob } from "../print-jobs/print-job.service";

// POST /print is the only public print entry point: it accepts generic
// PRINT_INSTRUCTIONS payloads (never invoice JSON, never RAW_COMMAND bytes)
// and converts them to ESC/POS internally - see README "Dumb bridge plus
// print-instruction design".
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
