import { BoardModel } from "../model/board.model";
import { List } from "../lib/list.interface";
import { BoardController } from "../controller/board.controller";
import { 
    cardIsComplete, cardDueToday, cardDueThisWeek, cardDueThisMonth, cardHasDueDate 
} from "../lib/card.filters";
const secrets = require("../../key.json");
const boards = require("../../boards.json");

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
        day: List;
        done: List;
        history: List
    } = {
        inbox: new List(),
        backlog: new List(),
        month: new List(),
        week: new List(),
        day: new List(),
        done: new List(),
        history: new List()
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
    /** instantiate private data members, board model and controller */
    const model = new ToDoBoardModel(boards.todo.id)
    const controller = new BoardController<ToDoBoardModel>(model, { 
        key: secrets.key, 
        token: secrets.token
    });

    /** 
     * groom the board
     *  NOTE: order is important here, do not change order without careful consideration 
     */
    const groom = async () => {

        const start = new Date();

        /** update task and prep dependencies */
        await controller.updateTaskDependencies("Tasks");
        await controller.updatePrepDependencies("Prep");

        await controller.assignDueDatesIf(model.lists.day.id, 1, 
            controller.hasLabelFilterFactory("Recurring"));
        await controller.assignDueDatesIf(model.lists.week.id, 6, 
            controller.hasLabelFilterFactory("Recurring"));
        await controller.assignDueDatesIf(model.lists.month.id, 28, 
            controller.hasLabelFilterFactory("Recurring"));
        

        /** move completed items to Done */
        await controller.moveCardsFromToIf([
            model.lists.inbox.id,
            model.lists.backlog.id, 
            model.lists.month.id, 
            model.lists.week.id,    
            model.lists.day.id 
        ], model.lists.done.id, cardIsComplete);

        /** move cards due today to Today */
        await controller.moveCardsFromToIf([
            model.lists.inbox.id,
            model.lists.backlog.id, 
            model.lists.month.id, 
            model.lists.week.id,    
        ], model.lists.day.id, cardDueToday);
        
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
