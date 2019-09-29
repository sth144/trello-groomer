import { BoardModel, List } from "./trello.interface";

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
    constructor(_id: string) {
        super();
        this.id = _id;
    }
}
