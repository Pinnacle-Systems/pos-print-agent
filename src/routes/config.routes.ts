import { Router } from "express";
import { getConfig, updatePrinterMappings } from "../config/config.service";
import { validatePrinterMappings } from "../printers/printer-validation.service";

export function createConfigRouter(): Router {
  const router = Router();

  router.get("/config", (_req, res) => {
    res.json(getConfig());
  });

  router.post("/config/printer-mappings", async (req, res, next) => {
    try {
      const validated = await validatePrinterMappings(req.body?.printerMappings);
      const updated = updatePrinterMappings(validated);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
