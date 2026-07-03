import { Router } from "express";
import { listPrinters } from "../printers/printer-discovery.service";

export function createPrintersRouter(): Router {
  const router = Router();

  router.get("/printers", async (_req, res, next) => {
    try {
      const printers = await listPrinters();
      res.json({ printers });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
