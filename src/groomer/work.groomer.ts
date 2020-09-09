import { BoardModel } from "../model/board.model";
import { List } from "../lib/list.interface";
import { BoardController } from "../controller/board.controller";
import { logger } from "../lib/logger";

export class WorkBoardModel extends BoardModel {
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
        backburner: new List(),
    };
    constructor(id: string) {
        super();
        this._id = id;
    }
}

export const WorkGroomer = function() {
    
    let start: Date;

    let workModel: WorkBoardModel;
    let workController: BoardController<WorkBoardModel>;

    const initialize = async () => {
        start = new Date();
        logger.info("Started " + start.toString());

    };

    const groom = async () => {
        logger.info("Grooming (Work)");

        delete require.cache;
    }

    return {
        run: async () => {
            await initialize();
            await groom();
        }
    }
}