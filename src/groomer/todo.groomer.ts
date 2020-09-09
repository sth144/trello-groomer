import { BoardModel } from "../model/board.model";
import { List } from "../lib/list.interface";
import { BoardController } from "../controller/board.controller";
import {
    cardIsComplete, cardDueToday, cardDueThisWeek, cardDueThisMonth, 
    cardHasDueDate, cardDueWithinTwoDays, Not, wasMovedFromToListFilterFactory
} from "../lib/card.filters";
import { DateRegexes, getMonthNumFromAbbrev } from "../lib/date.utils";
import { parseAutoDueConfig } from "../lib/parse.utils";
import { join } from "path";
import { existsSync, readdirSync } from "fs";
import { logger } from "../lib/logger";
const secrets = require("../../config/key.json");
const boards = require("../../config/boards.json");

/*************************************************************************************************
 * This file defines the shape of the ToDo board model, and implements the grooming behavior for *
 *  the ToDo board                                                                               *
 *************************************************************************************************/

export class ToDoBoardModel extends BoardModel {
    lists: {
        inbox: List;
        backlog: List;
        month: List;
        week: List;
        tomorrow: List;
        day: List;
        done: List;
        pinned: List;
        backburner: List;
    } = {
        inbox: new List(),
        backlog: new List(),
        month: new List(),
        week: new List(),
        tomorrow: new List(),
        day: new List(),
        done: new List(),
        pinned: new List(),
        backburner: new List()
    };
    constructor(id: string) {
        super();
        this._id = id;
    }
}

export class HistoryBoardModel extends BoardModel {
    lists: Record<string, List> = { };
    constructor(id: string) {
        super();
        this._id = id;
    }
}

/**
 * Factory which returns a groomer object, whose run() method will groom the Trello board
 */
export const ToDoGroomer = function() {

    let start: Date;
    let todoModel: ToDoBoardModel;
    let historyModel: HistoryBoardModel;
    let historyController: BoardController<HistoryBoardModel>;
    let todoController: BoardController<ToDoBoardModel>;

    const initialize = async () => {
        start = new Date();
        logger.info("Started " + start.toString());

        logger.info("Building models");
        /** instantiate private data members, board model and controller */
        todoModel = new ToDoBoardModel(boards.todo.id);
        historyModel = new HistoryBoardModel(boards.history.id);

        logger.info("Initializing controllers");
        todoController = new BoardController<ToDoBoardModel>(todoModel, {
            key: secrets.key,
            token: secrets.token
        });
        historyController = new BoardController<HistoryBoardModel>(historyModel, {
            key: secrets.key,
            token: secrets.token
        });

        await todoController.wakeUp();
        await historyController.wakeUp();
    }

    /**
     * groom the board
     *  NOTE: order is important here, do not change order without careful consideration
     */
    const groom = async () => {
        logger.info("Grooming (ToDo)");

        delete require.cache;

        logger.info("Syncing local config JSON files with configuration cards on board");

        await todoController.syncConfigJsonWithCard("auto-due.config.json", "Auto-Due Configuration");
        await todoController.syncConfigJsonWithCard("auto-label.config.json", "Auto-Label Configuration");
        await todoController.syncConfigJsonWithCard("auto-link.config.json", "Auto-Link Configuration");

        // TODO: how much of this procedure could be batched/parallelized?

        logger.info("Adding history lists from past 12 months to data model");
        /**
         * automatically add all history lists from past 12 months to board model. Names will be `${monthname} ${year}`
         *  - this should probably be factored out into groomer, this is not good generalized behavior
         */
        const yearnum = start.getFullYear() ;
        const monthnum = start.getMonth();
        await historyController.addListsToModelIfNameMeetsConditions([(x: List) => {
            return x.name.match(DateRegexes.MonthYear) !== null;
        }, (x: List) => {        
            /** if list in current calendar year */
            return  (x.name.indexOf(yearnum.toString()) !== -1)
                /** or list in last calendar year, but within last 12 months */
                || (x.name.indexOf((yearnum - 1).toString()) !== -1 
                    && getMonthNumFromAbbrev(x.name.substring(0,3)) > monthnum) 
        }]);

        const historyLists = todoController.importListsFromController(historyController);

        // TODO: introduce a simple machine learning model to come up with auto-label mappings
        logger.info("Adding labels to unlabeled cards according to machine learning model");

        const { spawn } = require("child_process");
        const subprocess = spawn("python3", ["label.py"], { cwd: "./model" });
        subprocess.stdout.on("data", (data: string) => {
            logger.info(data.toString());
        });
        subprocess.stderr.on("data", (err: string) => {
            logger.info(err.toString());
        });
        const closed = new Promise((res) => {
            subprocess.on("close", () => {
                res();
            });
        });
        await closed;

        logger.info(`Cache contents: ${readdirSync("./cache")}`);

        if (existsSync(join(process.cwd(), "cache/label.model-output.json"))) {
            const labelModelOutputPath = join(process.cwd(), "cache/label.model-output.json");
            if ( require.hasOwnProperty("cache") 
             &&  require.cache.hasOwnProperty(labelModelOutputPath) ) {
                delete require.cache[labelModelOutputPath]; 
            }
            const labelsFromModel = require(join(process.cwd(), "cache/label.model-output.json"));
            
            logger.info("Labels from ML model:");
            logger.info(JSON.stringify(labelsFromModel));
        }

        // TODO: once model implemented, reconsider how autolabelling occurs
        // TODO: integrate stopwords into the auto-labelling process

        /** auto-label cards based on titles */
        logger.info("Adding labels according to keywords in card titles");
        
        todoController.AllLabelNames
            /** work keyword conflicts with a lot of irrelevant card titles */
            .filter(x => x !== "Work")
            .forEach(async (labelName) => {
                await todoController.addLabelToCardsInListIfTitleContains(labelName, [labelName]);
            });
        
        const autoLabelConfigPath = join(process.cwd(), "config/auto-label.config.json");
        if (existsSync(autoLabelConfigPath)) {
            const autoLabelConfig = require(autoLabelConfigPath);

            Object.keys(autoLabelConfig).forEach(async (labelName) => {
                await todoController.addLabelToCardsInListIfTitleContains(labelName, autoLabelConfig[labelName]);
            });
        }

        logger.info("Updating task dependencies");

        /**
         * groom checklists
         *  - update task and prep dependencies, generate followups
         */
        await todoController.updateTaskDependencies("Tasks", /** ignore (necessary?) */ historyLists);
        await todoController.updatePrepDependencies("Prep", /** ignore (necessary?) */ historyLists);
        await todoController.updateFollowupDependencies("Followup", /** ignore (necessary?) */ historyLists);

        await todoController.markCardsDoneIfLinkedCheckItemsDone();
        await todoController.parseDueDatesFromCardNames();

        /** assign due dates to cards without due dates */
        const autoDueConfigPath = join(process.cwd(), "config/auto-due.config.json");
        if (existsSync(autoDueConfigPath)) {
            const autoDueConfig = parseAutoDueConfig(autoDueConfigPath) as { [s: string]: number };

            logger.info("Updating due dates based on manual list movements");

            await todoController.assignDueDatesIf(todoModel.lists.backlog.id, autoDueConfig.backlog,
                wasMovedFromToListFilterFactory(todoModel.lists.backlog.id, [
                    todoModel.lists.month.id,
                    todoModel.lists.week.id,
                    todoModel.lists.tomorrow.id,
                    todoModel.lists.day.id
                ]), 7 /** one week of random stagger (unique on per card basis, not per call to assignDueDatesIf */);
            await todoController.assignDueDatesIf(todoModel.lists.month.id, Math.floor(autoDueConfig.month),
                wasMovedFromToListFilterFactory(todoModel.lists.month.id, [
                    todoModel.lists.week.id,
                    todoModel.lists.tomorrow.id,
                    todoModel.lists.day.id
                ]));
            await todoController.assignDueDatesIf(todoModel.lists.week.id, autoDueConfig.week,
                wasMovedFromToListFilterFactory(todoModel.lists.week.id, [
                    todoModel.lists.tomorrow.id,
                    todoModel.lists.day.id
                ]));
            await todoController.assignDueDatesIf(todoModel.lists.tomorrow.id, autoDueConfig.tomorrow,
                wasMovedFromToListFilterFactory(todoModel.lists.tomorrow.id, [
                    todoModel.lists.day.id
                ]));


            await todoController.assignDueDatesIf(todoModel.lists.day.id, autoDueConfig.day, 
                Not(cardHasDueDate));
            await todoController.assignDueDatesIf(todoModel.lists.tomorrow.id, autoDueConfig.tomorrow, 
                Not(cardHasDueDate));
            await todoController.assignDueDatesIf(todoModel.lists.week.id, autoDueConfig.week,
                Not(cardHasDueDate)); 
            /** divide remaining days in 2 to stagger due dates avoid build up on last day of month */
            await todoController.assignDueDatesIf(todoModel.lists.month.id, Math.floor(autoDueConfig.month),
                Not(cardHasDueDate));
            await todoController.assignDueDatesIf(todoModel.lists.backlog.id, autoDueConfig.backlog, 
                Not(cardHasDueDate));

        }

        /** auto-link cards which share a label and a common word (>= 3 letters) in title */
        await todoController.autoLinkRelatedCards(
            require(join(__dirname, "../../config/auto-link.config.json")).ignoreWords
        );
        // TODO: instead of ignoreWords, could use a stopwords library?

        logger.info("Updating list placements");

        /** move completed items to Done */
        await todoController.moveCardsFromToIf([
            todoModel.lists.inbox.id,
            todoModel.lists.backlog.id,
            todoModel.lists.month.id,
            todoModel.lists.week.id,
            todoModel.lists.tomorrow.id,
            todoModel.lists.day.id
        ], todoModel.lists.done.id, cardIsComplete);

        /** move cards due today to Today */
        await todoController.moveCardsFromToIf([
            todoModel.lists.inbox.id,
            todoModel.lists.backlog.id,
            todoModel.lists.month.id,
            todoModel.lists.week.id,
            todoModel.lists.tomorrow.id,
        ], todoModel.lists.day.id, cardDueToday);

        /** move cards due tomorrow (or day after) to Tomorrow */
        await todoController.moveCardsFromToIf([
            todoModel.lists.inbox.id,
            todoModel.lists.backlog.id,
            todoModel.lists.month.id,
            todoModel.lists.week.id,
        ], todoModel.lists.tomorrow.id, cardDueWithinTwoDays);

        /** move cards due this week to Week */
        await todoController.moveCardsFromToIf([
            todoModel.lists.inbox.id,
            todoModel.lists.backlog.id,
            todoModel.lists.month.id,
        ], todoModel.lists.week.id, cardDueThisWeek);

        /** move cards due this month to month */
        await todoController.moveCardsFromToIf([
            todoModel.lists.inbox.id,
            todoModel.lists.backlog.id,
        ], todoModel.lists.month.id, cardDueThisMonth);

        /** move all cards in inbox with due date to backlog */
        await todoController.moveCardsFromToIf([
            todoModel.lists.inbox.id
        ], todoModel.lists.backlog.id, cardHasDueDate);

        logger.info("Marking appropriate items done");

        await todoController.markCardsInListDone(todoModel.lists.done.id);

        logger.info("Pruning repeat-labeled cards from history lists");

        historyLists.forEach(async (historyList) => {
            await historyController.deleteCardsInListIfLabeled(historyList.id, "Recurring")
        });

        logger.info("Removing due dates from cards in backburner list");
        await todoController.removeDueDateFromCardsInList(todoModel.lists.backburner.id);

        logger.info("dump JSON data for card labels to train machine learning model");
        todoController.dump();

        const curTime = new Date();
        const runtime = (curTime.getTime() - start.getTime()) / 1000;

        logger.info(`Sent ${todoController.NumRequests} requests in ${runtime} seconds`);
    }

    /** return the groomer object, exposing the run() method */
    return {
        run: async () => {
            await initialize();
            await groom();
        }
    }
}
