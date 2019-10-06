// TODO: if card in list done, and not marked done, mark done
// TODO: Find an easy way to set different due dates
// TODO: apply date parsing from card title to all cards, not just new task dependency items...
// TODO: add card to any list, not just inbox

import { BoardModel } from "../model/board.model";
import { ICard } from "../lib/card.interface";
import { List } from "../lib/list.interface";
import { Checklist, CheckItem } from "../lib/checklist.interface";
import { ReplaySubject} from "rxjs";
import { first } from "rxjs/operators";
import * as request from "request";
import { getNextWeekDay, Weekday } from "../lib/date.utils";

/**
 * RegEx's used to parse date, day, and time info from card titles
 */
const DateTimeRgx = new RegExp(/@\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d/);
const DateRgx = new RegExp(/@\d{4}-[01]\d-[0-3]\d/);
const DayNameTimeRgx = new RegExp(/@((mon|tues|wed(nes)?|thur(s)?|fri|sat(ur)?|sun)(day)?)T[0-2]\d:[0-5]\d/i);
const DayNameRgx = new RegExp(/@((mon|tues|wed(nes)?|thur(s)?|fri|sat(ur)?|sun)(day)?)/i)

/********************************************************************************************
 * BoardController exposes public methods which allow updating of Trello board. Enables     *
 *  automation of task dependencies                                                         *
 *******************************************************************************************/
export class BoardController<T extends BoardModel> {
    /**
     * emit a value to alert consumers that controller is initialized
     */
    private isAlive$ = new ReplaySubject<boolean>(1);
    public isAlive = this.isAlive$.pipe(first()).toPromise();

    constructor(private boardModel: T, private secrets: { key: string, token: string }) { 
        this.buildModel();
    }

    /**
     * asynchronously adds a card to the board (inbox)
     */
    public async addCard(opts: any): Promise<ICard> {
        return await this.asyncPost(`/cards?idList=${this.boardModel.lists.inbox.id}`, opts);
    }

    /**
     * create and modify cards according to task dependency system
     */
    public async updateTaskDependencies(checklistName: string) {
        /**
         * create cards for items in checklists named "checklistName"
         */
        const checklists = this.boardModel.getChecklists();
        for (const checklistId of Object.keys(checklists)) {
            /** find target checklist */
            if (checklists[checklistId].name === checklistName) {
                /** go through items */
                for (const checklistItem of checklists[checklistId].checkItems) {
                    /** check if item already has a card */
                    let alreadyExists = false;
                    for (const name of this.boardModel.getAllCardNames()) {
                        if (checklistItem.name.indexOf(name) !== -1) {
                            alreadyExists = true;
                        } 
                    }
                    /** if doesn't exist as card, and isn't complete */
                    if (!alreadyExists && checklistItem.state !== "complete" && checklistItem.name.indexOf("https://") === -1) {
                        const parentCard = this.boardModel.getCardById(checklists[checklistId].idCard);

                        let [parsedDueDate, childCardName] = this.parseDueDate(checklistItem.name, parentCard.due);

                        /** create a new card */
                        const childCard = await this.addCard({
                            name: childCardName,
                            due: parsedDueDate,
                            idLabels: parentCard.idLabels
                        });                 
                        
                        /** change name of checklist item to include link */
                        await this.asyncDelete(`/checklists/${checklistId}/checkItems/${checklistItem.id}/`);
                        const replacedCheckItem = await this.asyncPost(`/checklists/${checklistId}/checkItems/`, {
                            /** prevents multiple URLs from being inserted */
                            name: `${checklistItem.name.split("https://")[0]} ${childCard.shortUrl}`
                        });

                        /** link added card to parent @1 */
                        await this.asyncPost(`/cards/${childCard.id}/attachments`, {
                            name: `parent:${parentCard.id}|checklistId:${checklistId}|checkItemId:${replacedCheckItem.id}`,
                            url: parentCard.shortUrl
                        });
                    } 
                } 
            }
        }

        /** 
         * if card completed, and part of checklist, check on checklist 
         */
        for (const card of this.boardModel.getAllCards()) {
            /** ensure card is not complete and has attachments */
            if (card.dueComplete && card.badges.attachments > 0) {
                /** fetch attachments */
                const attachments = await this.asyncGet(`/cards/${card.id}/attachments`);
                /** for each attachment */
                for (const attachment of attachments) {
                    /** if attachment has substring "parent" (meaning it is a subtask) */
                    if (attachment.name.indexOf("parent") !== -1) {
                        /** split by delimiter "|" (see @1 above) and parse */
                        let info = attachment.name.split("|");
                        const parsed: any = {};
                        for (const item of info) {
                            const split = item.split(":");
                            const prop = split[0];
                            const val = split[1];
                            Object.assign(parsed, { [prop]: val });
                        }
                        /** find checklist corresponding to card and mark item complete */
                        if (parsed.hasOwnProperty("checklistId") && parsed.hasOwnProperty("checkItemId")) {
                            this.asyncPut(
                                `/cards/${parsed.parent}/checkItem/${parsed.checkItemId}?`
                               + `state=complete`).catch((err) => {
                                   console.log(err);
                               });
                        }
                    }
                }
            }
        }

        /** 
         * if checklist item completed, and has card, complete card 
         */
        for (const checklistItem of this.boardModel.getAllChecklistItems()) {
            if (checklistItem.state === "complete") {
                /** check that name includes link to card */
                const splitCheckItemName = checklistItem.name.split(" https://");
                if (splitCheckItemName.length > 1) {
                    for (const card of this.boardModel.getAllCards()) {
                        if (checklistItem.name.indexOf(card.shortUrl) !== -1) {
                            await this.asyncPut(`/cards/${card.id}?dueComplete=true`)
                        }
                    }
                }
            }
        }
    }

    /**
     * update cards according to prep dependency rules
     */
    public async updatePrepDependencies(checklistName: string): Promise<void> {
        /** go through all checklists */
            /** if checklist matches name */
                /** fetch all cards list */
                /** for each item in checklist */
                    /** if card (prep card) exists with name */
                        /** insert prep card shortURL into checklist name */
                        /** provide link to parent card in prep card */
        /** if card completed, and part of a prep list, check item on prep list */
        /** if prep checklist item completed, and has card, mark card complete */
    }

    /**
     * move all cards from list to list if pass filter
     * @param fromListIds source list
     * @param toListId destination list
     * @param filter the function through which to filter all cards to determine whether or not they should
     *                  be moved
     */
    public async moveCardsFromToIf(fromListIds: string[], toListId: string, filter: (card: ICard) => boolean): Promise<void> {
        for (const fromListId of fromListIds) {
            const from: List = this.boardModel.getListById(fromListId);
            const fromListCards = from.getCards();
            for (const card of fromListCards) {
                if (filter(card)) {

                    // TODO: this should be encapsulated in a moveCard operation
                    await this.asyncPut(`/cards/${card.id}?idList=${toListId}&pos=top`);

                    /** update local model */
                    [fromListId, toListId].forEach(async (id) => {
                        this.boardModel.getListById(id).cards = await this.asyncGet(`/lists/${id}/cards`);
                    });
                }
            }
        }
    }

    /**
     * initialize the board model (pull data from Trello)
     */
    private async buildModel(): Promise<void> {
        /** 
         * get all lists on board, map to lists specified on BoardModel 
         */
        const listsOnBoard = await this.asyncGet(`/board/${this.boardModel.id}/lists`);
        for (const responseList of listsOnBoard) {
            for (const listNameToFetch of this.boardModel.getListNames()) {
                if (responseList.name.toLowerCase().indexOf(listNameToFetch) !== -1) {
                    /** create a new list object in memory for each desired list */
                    Object.assign(this.boardModel.lists[listNameToFetch], { 
                        id: responseList.id,
                        name: responseList.name,
                        cards: []
                    });
                    /** fetch cards for list */
                    this.boardModel.lists[listNameToFetch].cards 
                        = await this.asyncGet(`/lists/${responseList.id}/cards`);
                    
                }
            }
        };

        /**
         * get all checklists on board
         */
        const checklistsOnBoard = await this.asyncGet(`/boards/${this.boardModel.id}/checklists`);
        for (const responseChecklist of checklistsOnBoard) {
            /** create a new checklist model in memory */
            this.boardModel.checkLists[responseChecklist.id] = new Checklist();
            Object.assign(this.boardModel.checkLists[responseChecklist.id], {
                id: responseChecklist.id,
                name: responseChecklist.name,
                idCard: responseChecklist.idCard,
            });
            /** populate in memory checklist model with checklist items */
            for (const responseCheckItem of responseChecklist.checkItems) {
                const newCheckItem = new CheckItem();
                Object.assign(newCheckItem, {
                    id: responseCheckItem.id,
                    idChecklist: responseCheckItem.idChecklist,
                    name: responseCheckItem.name,
                    state: responseCheckItem.state
                });
                this.boardModel.checkLists[responseChecklist.id].checkItems.push(newCheckItem);
            }
        }
        this.isAlive$.next(true);
    }

    /********************************************************************************************
     * Private methods which interact with the Trello API to retrieve / manipulate remote data  *
     ********************************************************************************************/

    private async asyncGet(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            request({
                method: "GET",
                uri: this.getLongUrl(url),
            }, (err: any, response: any, body: any) => {
                resolve(JSON.parse(body));
            });
        });
    }

    private async asyncPut(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            request({
                method: "PUT",
                uri: this.getLongUrl(url)
            }, (err: any, response: any, body: any) => {
                resolve(JSON.parse(body));
            });
        });
    }

    private async asyncPost(url: string, opts: any): Promise<any> {
        return new Promise((resolve, reject) => {
            let params = "";
            for (let prop of Object.keys(opts)) {
                params = params.concat(`&${prop}=${opts[prop]}`);
            }
            const uri = `${this.getLongUrl(url)}${params}`;
            request({
                method: "POST",
                uri: uri
            }, (err: any, response: any, body: any) => {
                resolve(JSON.parse(body));
            });
        });
    }

    private async asyncDelete(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            request({
                method: "DELETE",
                uri: this.getLongUrl(url)
            }, (err: any, response: any, body: any) => {
                resolve(JSON.parse(body));
            });
        });
    }

    /**
     * takes a URL path and returns a full url, with domain, key and token
     */
    private getLongUrl(path: string): string {
        let end = `key=${this.secrets.key}&token=${this.secrets.token}`;
        if (path.indexOf("?") === -1) {
            end = "?".concat(end);
        } else {
            end = "&".concat(end);
        }
        return `https://api.trello.com/1${path}${end}`;
    }

    // TODO: apply this to all cards, not just new task dependency items...

    /**
     * parses a string (card or checklist item name) for a date, time, day, etc.
     * @param inputStr name to parse
     * @param defaultDue this specifies the default due date if none parsed 
     */
    private parseDueDate(inputStr: string, defaultDue: string): string[] {
        let extractDue;
        let dueDate = defaultDue;
        let processedInputStr = inputStr

        if (extractDue = inputStr.match(DateTimeRgx)) {
            dueDate = extractDue[0];
            processedInputStr = inputStr.replace(DateTimeRgx, "");
        } else if (extractDue = inputStr.match(DateRgx)) {
            dueDate = `${extractDue[0]}T17:00`;
            processedInputStr = inputStr.replace(DateTimeRgx, "");
        } else if (extractDue = inputStr.match(DayNameTimeRgx)) {
            
            
            // TODO: parse day and time


        } else if (extractDue = inputStr.match(DayNameRgx)) {
            let day: string = extractDue[0].toLowerCase();
            const dayLowerCase = day.toLowerCase();
            /** first character will be @ */
            const dayCamelCase = `${dayLowerCase[1].toUpperCase()}${dayLowerCase.substring(2)}` as unknown;

            const WeekdayKeys = Object.keys(Weekday);
            let dayNum: number;
            for (let i = 0; i < WeekdayKeys.length; i++) {
                if (dayCamelCase === WeekdayKeys[i]) {
                    dayNum = i;
                }
            }

            dueDate = getNextWeekDay(dayNum as Weekday).toString();

            processedInputStr = inputStr.replace(DayNameRgx, `@${day[1].toUpperCase()}${day.substring(2)}`);
        }

        return [dueDate, processedInputStr];
    }
}


