import { join } from "path";
import { writeFileSync } from "fs";
import { logger } from "../lib/logger";
import { createApiServer } from "./server";
const secrets = require("../../config/key.json");

/*************************************************************************************************
 * Entry point for the read/write API. Runs as its own process: it only reads the snapshot files   *
 *  the groomers leave in cache/, so a fault here cannot interfere with a grooming run.            *
 *************************************************************************************************/

const PORT = parseInt(process.env.PORT, 10) || 4500;

process.on("unhandledRejection", (reason: unknown) => {
  logger.error(`Unhandled rejection in API: ${reason}`);
});

process.on("uncaughtException", (error: Error) => {
  logger.error("Uncaught exception in API:");
  logger.error(error.stack);
});

writeFileSync(join(process.cwd(), "cache/pid.api"), process.pid.toString());

const app = createApiServer({
  cacheDir: join(process.cwd(), "cache"),
  clientDir: join(process.cwd(), "client/dist/client/browser"),
  secrets,
  viewsBoard: process.env.VIEWS_BOARD || "todo",
});

app.listen(PORT, () => {
  logger.info(`Trello groomer API listening on :${PORT}`);
  logger.info(`  docs      http://localhost:${PORT}/api/docs`);
  logger.info(`  views     http://localhost:${PORT}/api/views`);
});
