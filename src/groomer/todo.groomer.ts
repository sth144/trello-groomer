import { BoardModel } from "../model/board.model";
import { List } from "../lib/list.interface";
import { BoardController } from "../controller/board.controller";
import {
    cardIsComplete, cardDueToday, cardDueThisWeek, cardDueThisMonth, cardHasDueDate, cardDueWithinThreeDays, Not, wasMovedFromToListFilterFactory
} from "../lib/card.filters";
import { DateRegexes, getMonthNumFromAbbrev } from "../lib/date.utils";
import { parseAutoDueConfig } from "../lib/parse.utils";
import { join } from "path";
import { existsSync } from "fs";
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
    } = {
        inbox: new List(),
        backlog: new List(),
        month: new List(),
        week: new List(),
        tomorrow: new List(),
        day: new List(),
        done: new List(),
        pinned: new List()
    };
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
    let model: ToDoBoardModel;
    let controller: BoardController<ToDoBoardModel>;

    const initialize = async () => {
        start = new Date();
        logger.info("Started " + start.toString());

        logger.info("Building model");
        /** instantiate private data members, board model and controller */
        model = new ToDoBoardModel(boards.todo.id)

        logger.info("Initializing controller");

        controller = new BoardController<ToDoBoardModel>(model, {
            key: secrets.key,
            token: secrets.token
        });

        await controller.wakeUp();
    }

    /**
     * groom the board
     *  NOTE: order is important here, do not change order without careful consideration
     */
    const groom = async () => {
        logger.info("Grooming");

        delete require.cache;

        logger.info("Syncing local config JSON files with configuration cards on board");

        await controller.syncConfigJsonWithCard("auto-due.config.json", "Auto-Due Configuration");
        await controller.syncConfigJsonWithCard("auto-label.config.json", "Auto-Label Configuration");
        await controller.syncConfigJsonWithCard("auto-link.config.json", "Auto-Link Configuration");

// TODO: how much of this procedure could be batched/parallelized?

        logger.info("Adding history lists from past 12 months to data model");
        /**
         * automatically add all history lists from past 12 months to board model. Names will be `${monthname} ${year}`
         *  - this should probably be factored out into groomer, this is not good generalized behavior
         */
        const yearnum = start.getFullYear() ;
        const monthnum = start.getMonth();
        const historyLists = await controller.addListsToModelIfNameMeetsConditions([(x: List) => {
            return x.name.match(DateRegexes.MonthYear) !== null;
        }, (x: List) => {        
            /** if list in current calendar year */
            return  (x.name.indexOf(yearnum.toString()) !== -1)
                /** or list in last calendar year, but within last 12 months */
                || (x.name.indexOf((yearnum - 1).toString()) !== -1 
                    && getMonthNumFromAbbrev(x.name.substring(0,3)) > monthnum) 
        }]);




        // TODO: introduce a simple machine learning model to come up with auto-label mappings
        logger.info("Adding labels to unlabeled cards according to machine learning model");

        const { spawn } = require("child_process");
        const subprocess = spawn("python3", ["label.py"], { cwd: "./model" });
        subprocess.stdout.on("data", (data: string) => {
            logger.info(data.toString());
        });
        const closed = new Promise((res) => {
            subprocess.on("close", () => {
                res();
            });
        });
        await closed;

        console.log("LABELS FROM MODEL");
        delete require.cache[join(process.cwd(), "cache/label.model-output.json")];
        if (existsSync(join(process.cwd(), "cache/label.model-output.json"))) {

            console.log(require(join(process.cwd(), "cache/label.model-output.json")))
        }



        
        // TODO: once model implemented, reconsider how autolabelling occurs
        // TODO: integrate stopwords into the auto-labelling process

        /** auto-label cards based on titles */
        logger.info("Adding labels according to keywords in card titles");
        
        controller.AllLabelNames
            /** work keyword conflicts with a lot of irrelevant card titles */
            .filter(x => x !== "Work")
            .forEach(async (labelName) => {
                await controller.addLabelToCardsInListIfTitleContains(labelName, [labelName]);
            });
        
        const autoLabelConfigPath = join(process.cwd(), "config/auto-label.config.json");
        if (existsSync(autoLabelConfigPath)) {
            const autoLabelConfig = require(autoLabelConfigPath);

            Object.keys(autoLabelConfig).forEach(async (labelName) => {
                await controller.addLabelToCardsInListIfTitleContains(labelName, autoLabelConfig[labelName]);
            });
        }

        logger.info("Updating task dependencies");

        /**
         * groom checklists
         *  - update task and prep dependencies, generate followups
         */
        await controller.updateTaskDependencies("Tasks", /** ignore (necessary?) */ historyLists);
        await controller.updatePrepDependencies("Prep", /** ignore (necessary?) */ historyLists);
        await controller.updateFollowupDependencies("Followup", /** ignore (necessary?) */ historyLists);

        await controller.markCardsDoneIfLinkedCheckItemsDone();
        await controller.parseDueDatesFromCardNames();

        /** assign due dates to cards without due dates */
        const autoDueConfigPath = join(process.cwd(), "config/auto-due.config.json");
        if (existsSync(autoDueConfigPath)) {
            const autoDueConfig = parseAutoDueConfig(autoDueConfigPath) as { [s: string]: number };

            logger.info("Updating due dates based on manual list movements");

            await controller.assignDueDatesIf(model.lists.backlog.id, autoDueConfig.backlog,
                wasMovedFromToListFilterFactory(model.lists.backlog.id, [
                    model.lists.month.id,
                    model.lists.week.id,
                    model.lists.tomorrow.id,
                    model.lists.day.id
                ]), 7 /** one week of random stagger (unique on per card basis, not per call to assignDueDatesIf */);
            await controller.assignDueDatesIf(model.lists.month.id, Math.floor(autoDueConfig.month),
                wasMovedFromToListFilterFactory(model.lists.month.id, [
                    model.lists.week.id,
                    model.lists.tomorrow.id,
                    model.lists.day.id
                ]));
            await controller.assignDueDatesIf(model.lists.week.id, autoDueConfig.week,
                wasMovedFromToListFilterFactory(model.lists.week.id, [
                    model.lists.tomorrow.id,
                    model.lists.day.id
                ]));
            await controller.assignDueDatesIf(model.lists.tomorrow.id, autoDueConfig.tomorrow,
                wasMovedFromToListFilterFactory(model.lists.tomorrow.id, [
                    model.lists.day.id
                ]));


            await controller.assignDueDatesIf(model.lists.day.id, autoDueConfig.day, 
                Not(cardHasDueDate));
            await controller.assignDueDatesIf(model.lists.tomorrow.id, autoDueConfig.tomorrow, 
                Not(cardHasDueDate));
            await controller.assignDueDatesIf(model.lists.week.id, autoDueConfig.week,
                Not(cardHasDueDate)); 
            /** divide remaining days in 2 to stagger due dates avoid build up on last day of month */
            await controller.assignDueDatesIf(model.lists.month.id, Math.floor(autoDueConfig.month),
                Not(cardHasDueDate));
            await controller.assignDueDatesIf(model.lists.backlog.id, autoDueConfig.backlog, 
                Not(cardHasDueDate));

        }

        /** auto-link cards which share a label and a common word (>= 3 letters) in title */
        await controller.autoLinkRelatedCards(
            require(join(__dirname, "../../config/auto-link.config.json")).ignoreWords
        );
        // TODO: instead of ignoreWords, could use a stopwords library?




        logger.info("Updating list placements");

        /** move completed items to Done */
        await controller.moveCardsFromToIf([
            model.lists.inbox.id,
            model.lists.backlog.id,
            model.lists.month.id,
            model.lists.week.id,
            model.lists.tomorrow.id,
            model.lists.day.id
        ], model.lists.done.id, cardIsComplete);

        /** move cards due today to Today */
        await controller.moveCardsFromToIf([
            model.lists.inbox.id,
            model.lists.backlog.id,
            model.lists.month.id,
            model.lists.week.id,
            model.lists.tomorrow.id,
        ], model.lists.day.id, cardDueToday);

        /** move cards due tomorrow (or day after) to Tomorrow */
        await controller.moveCardsFromToIf([
            model.lists.inbox.id,
            model.lists.backlog.id,
            model.lists.month.id,
            model.lists.week.id,
        ], model.lists.tomorrow.id, cardDueWithinThreeDays);

        /** move cards due this week to Week */
        await controller.moveCardsFromToIf([
            model.lists.inbox.id,
            model.lists.backlog.id,
            model.lists.month.id,
        ], model.lists.week.id, cardDueThisWeek);

        /** move cards due this month to month */
        await controller.moveCardsFromToIf([
            model.lists.inbox.id,
            model.lists.backlog.id,
        ], model.lists.month.id, cardDueThisMonth);

        /** move all cards in inbox with due date to backlog */
        await controller.moveCardsFromToIf([
            model.lists.inbox.id
        ], model.lists.backlog.id, cardHasDueDate);

        logger.info("Marking appropriate items done");

        await controller.markCardsInListDone(model.lists.done.id);

        logger.info("Pruning repeat-labeled cards from history lists")

        historyLists.forEach(async (historyList) => {
            await controller.deleteCardsInListIfLabeled(historyList.id, "Recurring")
        });

        // TODO: dump JSON data for card labels to train machine learning model
        controller.dump();

        const curTime = new Date();
        const runtime = (curTime.getTime() - start.getTime()) / 1000;

        logger.info(`Sent ${controller.NumRequests} requests in ${runtime} seconds`);
    }

    /** return the groomer object, exposing the run() method */
    return {
        run: async () => {
            await initialize();
            await groom();
        }
    }
}
