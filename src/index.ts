import { ToDoGroomer } from "./groomer/todo.groomer";
import { writeFileSync } from "fs";
import { join } from "path";
import { logger } from "./lib/logger";

writeFileSync(join(process.cwd(), "cache/pid"), process.pid);

process.on("unhandledRejection", (reason: any, p: Promise<any>) => {
    console.error(reason);
});

/** node-cron has a bug, reimplemented using setInterval until a better solution is identified */

// TODO: provide a timeout to catch "stuck" runs and abort

let mutex = false, iter = 0, jobNo = 0;

(async function runJob() { 
    setTimeout(runJob, 5 * 60 * 1000);
    logger.info(`************************************`
                +` Starting job (${iter++}) ${(new Date()).toLocaleTimeString()}`
                +` ***************************************`);
    if (!mutex) {
        logger.info("Mutex acquired");
        [ mutex, jobNo ] = [ true, jobNo + 1 ];
        try {
            const f = setTimeout(() => { throw new Error("Job timed out"); }, 2 * 5 * 60 * 10000);
            const groomer = await ToDoGroomer();
            await groomer.run();
            mutex = false;
            logger.info(`Job finished ${(new Date()).toLocaleTimeString()}, mutex released`);
            clearTimeout(f);
        } catch (e) {
            logger.info(`Run failed: ${e}`);
            mutex = false;
        }
    } else {
        logger.info(`Job ${jobNo} is still running, skipping scheduled run`);
    }
})()

// TODO: introduce daily, weekly, monthy tasks (when robust enough), replace Trello Butler