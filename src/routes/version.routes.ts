import { Router } from "express";
import { AGENT_NAME } from "../agent-info";
import { BUILD_INFO } from "../version-info";

export function createVersionRouter(): Router {
  const router = Router();

  router.get("/version", (_req, res) => {
    res.json({
      agentName: AGENT_NAME,
      version: BUILD_INFO.version,
      buildTime: BUILD_INFO.buildTime,
      platform: process.platform,
      arch: process.arch,
    });
  });

  return router;
}
