import { loadConfig } from "./config/config.service";
import { logger } from "./logging/logger";
import { createServer } from "./server";

const HOST = "127.0.0.1";

function main(): void {
  const config = loadConfig();
  const app = createServer(config);

  app.listen(config.agentPort, HOST, () => {
    logger.info(`Pinnacle POS Print Agent listening on http://${HOST}:${config.agentPort}`);
  });
}

main();
