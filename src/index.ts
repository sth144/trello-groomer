import { ToDoGroomer } from "./groomer/todo.groomer";
import { WorkGroomer } from "./groomer/work.groomer";
import { writeFileSync } from "fs";
import { join } from "path";
import { logger } from "./lib/logger";

let whichGroomer: string = null;

if (process.argv.length < 3) {
    logger.error("Usage: node dist/index.js ${groomer}");
    process.exit(1);
} else {
    whichGroomer = process.argv[2];
}

writeFileSync(join(process.cwd(), `cache/pid.${whichGroomer}`), process.pid);

process.on("unhandledRejection", (reason: any, p: Promise<any>) => {
    logger.error(reason);
});

const CronJob = require("cron").CronJob;

let mainMutex = false, mainJobNo = 0;

switch (whichGroomer) {
    case "work": {
        const workJob = new CronJob(
            '0 */30 * * * *', /** time pattern */
            async () => {
                logger.info(`************************************`
                            +` Starting job (${mainJobNo + 1}) (Work board) ${(new Date()).toString()}`
                            +` ***************************************`);
                if (!mainMutex) {
                    logger.info("Mutex acquired");
                    [ mainMutex, mainJobNo ] = [ true, mainJobNo + 1 ];
                    try {
                        const failureTimeout = setTimeout(() => { 
                            throw new Error("Job timed out"); 
                        }, 2 * 5 * 60 * 10000);
        
                        const workGroomer = WorkGroomer();
                        await workGroomer.run();
                        
                        mainMutex = false;
                        logger.info(`Job ${mainJobNo} finished ${(new Date()).toLocaleTimeString()}, mutex released`);
                        clearTimeout(failureTimeout);
                    } catch (e) {
                        logger.info(`Run ${mainJobNo} failed: ${e}`);
                        mainMutex = false;
                    }
                } else {
                    logger.info(`Job ${mainJobNo} is still running, skipping scheduled run`);
                }
            }, /** onTick */
            null /** onComplete */, 
            false /** start (?) */, 
            "America/Chicago" /** time zone */, 
            this /** context (?) */, 
            true /** run on init, runs right away, then begins running every 10 min */
        );

        workJob.start();
        break;
    }
    default: 
    case "todo": {
        const todoJob = new CronJob(
            '0 */5 * * * *', /** time pattern */
            async () => {
                logger.info(`************************************`
                            +` Starting job ${mainJobNo + 1} (ToDo board) ${(new Date()).toString()}`
                            +` ***************************************`);
                if (!mainMutex) {
                    logger.info("Mutex acquired");
                    [ mainMutex, mainJobNo ] = [ true, mainJobNo + 1 ];
                    try {
                        const failureTimeout = setTimeout(() => { 
                            throw new Error("Job timed out"); 
                        }, 2 * 5 * 60 * 10000);
        
                        const toDoGroomer = ToDoGroomer();
                        await toDoGroomer.run();
                        
                        mainMutex = false;
                        logger.info(`Job ${mainJobNo} finished ${(new Date()).toLocaleTimeString()}, mutex released`);
                        clearTimeout(failureTimeout);
                    } catch (e) {
                        logger.info(`Run ${mainJobNo} failed: ${e}`);
                        mainMutex = false;
                    }
                } else {
                    logger.info(`Job ${mainJobNo} is still running, skipping scheduled run`);
                }
            }, /** onTick */
            null /** onComplete */, 
            false /** start (?) */, 
            "America/Chicago" /** time zone */, 
            this /** context (?) */, 
            true /** run on init, runs right away, then begins running every 10 min */
        );

        todoJob.start();
        break;
    }
}



// TODO: introduce daily, weekly, monthy tasks (when robust enough), replace Trello Butler