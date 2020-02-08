import { BoardModel } from "../model/board.model";
import { List } from "../lib/list.interface";
import { BoardController } from "../controller/board.controller";
import {
    cardIsComplete, cardDueToday, cardDueThisWeek, cardDueThisMonth, cardHasDueDate, cardDueWithinThreeDays, Not
} from "../lib/card.filters";
import { DateRegexes, getMonthNumFromAbbrev, getRemnDaysInWeek, getRemnDaysInMonth } from "../lib/date.utils";
import { join } from "path";
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
    } = {
        inbox: new List(),
        backlog: new List(),
        month: new List(),
        week: new List(),
        tomorrow: new List(),
        day: new List(),
        done: new List(),
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
    console.log("Started " + new Date().toString());

    console.log("Building model");

    /** instantiate private data members, board model and controller */
    const model = new ToDoBoardModel(boards.todo.id)

    console.log("Initializing controller");

    const controller = new BoardController<ToDoBoardModel>(model, {
        key: secrets.key,
        token: secrets.token
    });

    /**
     * groom the board
     *  NOTE: order is important here, do not change order without careful consideration
     */
    const groom = async () => {
        console.log("Grooming");

        console.log("Adding history lists from past 12 months to data model");
        /**
         * automatically add all history lists from past 12 months to board model. Names will be `${monthname} ${year}`
         *  - this should probably be factored out into groomer, this is not good generalized behavior
         */
        const start = new Date();
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

        /** auto-label cards based on titles */
        console.log("Adding labels according to keywords in card titles");
        
        controller.AllLabelNames
            /** work keyword conflicts with a lot of irrelevant card titles */
            .filter(x => x !== "Work")
            .forEach(async (labelName) => {
                await controller.addLabelToCardsInListIfTitleContains(labelName, [labelName]);
            });
        
        const autoLabelConfig = require(join(__dirname, "../../config/auto-label.config.json"));

        Object.keys(autoLabelConfig).forEach(async (labelName) => {
            await controller.addLabelToCardsInListIfTitleContains(labelName, autoLabelConfig[labelName]);
        });

        console.log("Updating task dependencies");

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
        await controller.assignDueDatesIf(model.lists.day.id, 1, 
            Not(cardHasDueDate));
        await controller.assignDueDatesIf(model.lists.tomorrow.id, 2, 
            Not(cardHasDueDate));
        await controller.assignDueDatesIf(model.lists.week.id, getRemnDaysInWeek(),
            Not(cardHasDueDate)); 
        /** divide remaining days in 2 to stagger due dates avoid build up on last day of month */
        await controller.assignDueDatesIf(model.lists.month.id, Math.floor(getRemnDaysInMonth() / 2),
            Not(cardHasDueDate));

        /** auto-link cards which share a label and a common word (>= 3 letters) in title */
        await controller.autoLinkRelatedCards(
            require(join(__dirname, "../../config/auto-link.config.json")).ignoreWords
        );

        console.log("Updating list placements");

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

        console.log("Marking appropriate items done");

        await controller.markCardsInListDone(model.lists.done.id);

        console.log("Pruning repeat-labeled cards from history lists")

        historyLists.forEach(async (historyList) => {
            await controller.deleteCardsInListIfLabeled(historyList.id, "Recurring")
        });


        const runtime = +(new Date()) - +(start);

        console.log(`Sent ${controller.NumRequests} requests in ${runtime}ms`);
    }

    /** return the groomer object, exposing the run() method */
    return {
        run: () => {
            controller.isAlive.then(groom);
        }
    }
}
