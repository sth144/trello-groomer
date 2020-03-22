import { ToDoGroomer } from "./groomer/todo.groomer";
import { writeFileSync } from "fs";
import { join } from "path";
import { logger } from "./lib/logger";

writeFileSync(join(process.cwd(), "cache/pid"), process.pid);

process.on("unhandledRejection", (reason: any, p: Promise<any>) => {
    console.error(reason);
});

/**
 * create a ToDoGroomer object and run groomer on start, then set up a Cron job to keep
 *  running every 10 min
 */
const CronJob = require('cron').CronJob;

let mutex = false;
const job = new CronJob(
    '0 */5 * * * *', /** time pattern */
    () => {
        logger.info(`************************************`
                    +` Starting Cron job ${(new Date()).toLocaleTimeString()}`
                    +` ***************************************`);
        if (!mutex) {
            logger.info("Mutex acquired");
            mutex = true;
            ToDoGroomer().run().then(() => {
                mutex = false;
                logger.info(`Cron job finished ${(new Date()).toLocaleTimeString()}, mutex released`);
            }).catch((e) => {
                logger.info(`Run failed: ${e}`);
                mutex = false;
            });
        } else {
            logger.info("There is still a job running, skipping scheduled run");
        }
    }, /** onTick */
    null /** onComplete */, 
    false /** start (?) */, 
    "America/Chicago" /** time zone */, 
    this /** context (?) */, 
    true /** run on init, runs right away, then begins running every 10 min */
);

job.start();
// TODO: introduce daily, weekly, monthy tasks (when robust enough), replace Trello Butler