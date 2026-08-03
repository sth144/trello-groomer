import { join } from "path";
import { writeFileSync } from "fs";
import { logger } from "../lib/logger";
import { createApiServer } from "./server";
import { AuthConfigError, loadAuthConfig } from "./auth";
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

const configDir = join(process.cwd(), "config");

/**
 * Auth is required unless explicitly disabled. Failing to start is deliberate: a misconfigured
 *  deployment that silently served an open API would be worse than a pod that reports NotReady.
 *  Set ALLOW_UNAUTHENTICATED=true only for local development.
 */
let auth;
if (process.env.ALLOW_UNAUTHENTICATED === "true") {
  logger.error(
    "ALLOW_UNAUTHENTICATED=true — starting with no authentication. Never do this " +
      "on anything reachable beyond localhost."
  );
} else {
  try {
    auth = loadAuthConfig(configDir);
  } catch (e) {
    if (e instanceof AuthConfigError) {
      logger.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}

const app = createApiServer({
  cacheDir: join(process.cwd(), "cache"),
  clientDir: join(process.cwd(), "client/dist/client/browser"),
  secrets,
  viewsBoard: process.env.VIEWS_BOARD || "todo",
  auth,
});

app.listen(PORT, () => {
  logger.info(`Trello groomer API listening on :${PORT}`);
  logger.info(`  docs      http://localhost:${PORT}/api/docs`);
  logger.info(`  views     http://localhost:${PORT}/api/views`);
});
