// TODO: if card in list done, and not marked done, mark done
// TODO: add card from checklist to any list, not just inbox
// TODO: recurring cards with due dates
// TODO: documentation card in Trello board

import { BoardModel } from "../model/board.model";
import { ICard } from "../lib/card.interface";
import { List } from "../lib/list.interface";
import { Checklist, CheckItem } from "../lib/checklist.interface";
import { ReplaySubject} from "rxjs";
import { first } from "rxjs/operators";
import { getNDaysFromNow, parseDueDate, DateRegexes } from '../lib/date.utils';
const request = require("request");

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

    private numRequestsSent: number = 0;
    public get NumRequests(): number {
        return this.numRequestsSent;
    }

    constructor(private boardModel: T, private secrets: { key: string, token: string }) {
        this.buildModel();
    }

    /**
     * asynchronously adds a card to the board (inbox)
     */
    public async addCard(opts: any): Promise<ICard> {
        return await this.asyncPost(`/cards?idList=${(this.boardModel.getLists() as any).inbox.id}`, opts);
    }

    public hasLabelFilterFactory(labelName: string) {
        const targetLabelId = this.boardModel.getLabels()[labelName];

        return (card: ICard) => {
            if (card.idLabels.filter((idLabel) => idLabel === targetLabelId).length > 0)
                return true;
            return false;
        }
    }
    /**
     * create and modify cards according to task dependency system
     * TODO: refactor to use map();
     * TODO: document rules
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

                    let parentCard;

                    /** if doesn't exist as card, and isn't complete */
                    if (!alreadyExists && checklistItem.state !== "complete" && checklistItem.name.indexOf("https://") === -1
                        /** get reference to parent card, abort if undefined */
                        && ((parentCard = this.boardModel.getCardById(checklists[checklistId].idCard)) !== undefined)) {
                        let parsedResult = parseDueDate(checklistItem.name, parentCard.due);

                        /** create a new card */
                        const childCard = await this.addCard({
                            name: parsedResult.processedInputStr,
                            due: parsedResult.dueDateStr,
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
                        if (parsed.hasOwnProperty("checklistId") && parsed.hasOwnProperty("checkItemId")
                            && this.boardModel.getAllChecklistItems().filter((x) => {
                                x.id === parsed["checkItemId"] && x.state !== "complete"
                            }).length > 0) {
                            this.asyncPut(`/cards/${parsed.parent}/checkItem/${parsed.checkItemId}?`
                               + `state=complete`).catch((err) => {
                                   console.log(err);
                               });
                        }
                    }
                }
            }
        }
    }

    /**
     * update cards according to prep dependency rules
     * TODO: document rules
     */
    public async updatePrepDependencies(targetChecklistName: string): Promise<void> {
        const checklists = this.boardModel.getChecklists();
        const allCards = this.boardModel.getAllCards();
        let targetChecklist = null;

        /** go through all checklists */
        Object.keys(checklists).map((checklistId) => {
            /** find target checklist */
            if (checklists[checklistId].name === targetChecklistName) {
                targetChecklist = checklists[checklistId];
                targetChecklist.checkItems.map((checklistItem) => {
                    allCards.map(async (prepCard) => {
                        /** if card (prep card) exists with name */
                        if (checklistItem.name === prepCard.name) {
                            /** insert prep card shortURL into check item name */
                            await this.asyncDelete(`/checklists/${checklistId}/checkItems/${checklistItem.id}/`);
                            const replacedCheckItem = await this.asyncPost(`/checklists/${checklistId}/checkItems/`, {
                                /** split()[] prevents multiple URLs from being inserted */
                                name: `${checklistItem.name.split("https://")[0]} ${prepCard.shortUrl}`
                            });

                            const dependentCard = this.boardModel.getCardById(checklists[checklistId].idCard);
                            /** provide link to dependent card in prep card */
                            await this.asyncPost(`/cards/${prepCard.id}/attachments`, {
                                name: `dependent:${dependentCard.id}|checklistId:${checklistId}|checkItemId:${replacedCheckItem.id}`,
                                url: dependentCard.shortUrl
                            });
                        }
                    });
                });
            }
        });

        /** go through all cards */
        if (targetChecklist !== null) {
            /** if card completed, and part of a prep list, check item on prep list */
            allCards.filter((card) => (card.dueComplete && card.badges.attachments > 0))
                .map(async (card) => {
                    (await this.asyncGet(`/cards/${card.id}/attachments`)).map((attachment: any) => {
                        if (attachment.name !== undefined && attachment.name.indexOf("dependent") !== -1) {
                            const parsed: any = { };
                            const info = attachment.name.split("|");
                            for (const item of info) {
                                let split = item.split(":");
                                if (split.length === 2) {
                                    Object.assign(parsed, { [split[0]]: split[1] });
                                };
                            }
                            /** find checklist corresponding dependent to card and mark item complete */
                            if (parsed.hasOwnProperty("checklistId") && parsed.hasOwnProperty("checkItemId")
                                && this.boardModel.getAllChecklistItems().filter((x) => {
                                    x.id === parsed["checkItemId"] && x.state !== "complete"
                                }).length > 0) {
                                this.asyncPut(`/cards/${parsed.dependent}/checkItem/${parsed.checkItemId}?`
                                    + `state=complete`).catch((err) => {
                                        console.log(err);
                                    });
                                }
                        }
                    });
                });
        }
    }

    public async updateFollowupDependencies(targetChecklistName: string): Promise<void> {
        const checklists = this.boardModel.getChecklists();
        const allCards = this.boardModel.getAllCards();
        let targetChecklist = null;

        /** go through all checklists and find target*/
        Object.keys(checklists).filter((checklistId) => checklists[checklistId].name === targetChecklistName)
            .forEach((checklistId) => {
                targetChecklist = checklists[checklistId];
                targetChecklist.checkItems.forEach(async (checklistItem: CheckItem) => {
                    /** if doesn't exist as card, and isn't complete */
                    if (checklistItem.state !== "complete" && !(allCards.some(x => x.name.indexOf(checklistItem.name) !== -1))
                        && checklistItem.name.indexOf("https://") === -1) {

                        const parentCard = this.boardModel.getCardById(checklists[checklistId].idCard);

                        let parsedResult = parseDueDate(checklistItem.name, parentCard.due);

                        /** create a new card */
                        const childCard = await this.addCard({
                            name: parsedResult.processedInputStr,
                            due: parsedResult.dueDateStr,
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

                });
            });

        /** go through all cards */
        if (targetChecklist !== null) {
            /** if card completed, and part of a followup list, check item on followup list */
            allCards.filter((card) => (card.dueComplete && card.badges.attachments > 0))
                .map(async (card) => {
                    (await this.asyncGet(`/cards/${card.id}/attachments`)).map((attachment: any) => {
                        if (attachment.name !== undefined && attachment.name.indexOf("dependent") !== -1) {
                            const parsed: any = { };
                            const info = attachment.name.split("|");
                            for (const item of info) {
                                let split = item.split(":");
                                if (split.length === 2) {
                                    Object.assign(parsed, { [split[0]]: split[1] });
                                };
                            }
                            /** find checklist corresponding dependent to card and mark item complete */
                            if (parsed.hasOwnProperty("checklistId") && parsed.hasOwnProperty("checkItemId")
                                && this.boardModel.getAllChecklistItems().filter((x) => {
                                    x.id === parsed["checkItemId"] && x.state !== "complete"
                                }).length > 0) {
                                this.asyncPut(`/cards/${parsed.dependent}/checkItem/${parsed.checkItemId}?`
                                    + `state=complete`).catch((err) => {
                                        console.log(err);
                                    });
                                }
                        }
                    });
                });
        }

    }

    public async markCardsDoneIfLinkedCheckItemsDone() {
        /**
         * if checklist item completed, and has card, complete card
         */
        for (const checklistItem of this.boardModel.getAllChecklistItems()) {
            if (checklistItem.state === "complete") {
                /** check that name includes link to card */
                const splitCheckItemName = checklistItem.name.split(" https://");
                if (splitCheckItemName.length > 1) {
                    for (const card of this.boardModel.getAllCards()) {
                        if (checklistItem.name.indexOf(card.shortUrl) !== -1 && !card.dueComplete) {
                            console.log("CARD DONE FROM CHECKLIST ");
                            console.log(card.name);
                            await this.asyncPut(`/cards/${card.id}?dueComplete=true`);
                            console.log("PUT DONE");
                        }
                    }
                }
            }
        }
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

                    console.log("MOVE CARD TO LIST " + card.name + " " + fromListId + " " + toListId);
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

    public async assignDueDatesIf(listId: string, dueInDays: number, conditionFilter: (card: ICard) => boolean)
        : Promise<void> {
        const dueDate: Date = getNDaysFromNow(dueInDays);

        this.boardModel.getListById(listId).getCards()
            .filter((card) => card.due === null)
            .filter(conditionFilter)
            .map(async (card) => {
                await this.asyncPut(`/cards/${card.id}?due=${dueDate}`);
            });
    }

    public async markCardsInListDone(listId: string): Promise<void> {
        this.boardModel.getListById(listId).getCards()
            .filter((card) => card.due !== null)
            .filter((card) => card.dueComplete === false)
            .map(async (card) => {
                await this.asyncPut(`/cards/${card.id}?dueComplete=true`);
            });
    }

    public async parseDueDatesFromCardNames(): Promise<void> {
        for (const card of this.boardModel.getAllCards()) {
            let parsedResult = parseDueDate(card.name, null), dueDate, parsedName;
            if (card.due === null
                && ((dueDate = parsedResult.dueDateStr) !== null)
                && ((parsedName = parsedResult.processedInputStr) !== null)) {
                await this.asyncPut(`/cards/${card.id}?due=${dueDate}&name=${parsedName}`);
            }
        }
    }

    /**
     * initialize the board model (pull data from Trello)
     */
    private async buildModel(): Promise<void> {
        console.log("Retrieving lists");
        /**
         * get all lists on board, map to lists specified on BoardModel
         */
        const listsOnBoard = await this.asyncGet(`/board/${this.boardModel.id}/lists`).catch((err) => console.error(err));
        const modelListsHandle = this.boardModel.getLists() as any;

        for (const responseList of listsOnBoard) {
            for (const listNameToFetch of this.boardModel.getListNames()) {
                if (responseList.name.toLowerCase().indexOf(listNameToFetch) !== -1) {
                    /** create a new list object in memory for each desired list */
                    Object.assign(modelListsHandle[listNameToFetch], {
                        id: responseList.id,
                        name: responseList.name,
                        cards: []
                    });
                    /** fetch cards for list */
                    (modelListsHandle)[listNameToFetch].cards
                        = await this.asyncGet(`/lists/${responseList.id}/cards`);
                }
            }

            if (responseList.name.match(DateRegexes.MonthYear) && !modelListsHandle.hasOwnProperty(responseList.name)) {
                /** create a new list object in memory for each desired list */
                Object.assign(modelListsHandle, {
                    [responseList.name]: Object.assign(new List(), {
                        id: responseList.id,
                        name: responseList.name,
                        cards: []
                    })
                });
                /** fetch cards for list */
                (modelListsHandle)[responseList.name].cards
                    = await this.asyncGet(`/lists/${responseList.id}/cards`);
            }
        };

        /**
         * get all checklists on board
         */
        const checklistsOnBoard = await this.asyncGet(`/boards/${this.boardModel.id}/checklists`);

        for (const responseChecklist of checklistsOnBoard) {
            /** create a new checklist model in memory */
            (this.boardModel.getChecklists() as any)[responseChecklist.id] = new Checklist();
            Object.assign((this.boardModel.getChecklists() as any)[responseChecklist.id], {
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
                (this.boardModel.getChecklists())[responseChecklist.id].checkItems.push(newCheckItem);
            }
        }

        console.log("Retrieving labels");
        /**
         * get all labels on board
         */
        const allLabels = { };
        (await this.asyncGet(`/boards/${this.boardModel.id}/labels`)).map((label: any) => {
            if (label.hasOwnProperty("id") && label.hasOwnProperty("name")) {
                Object.assign(allLabels, { [label.name]: label.id })
            }
        });
        this.boardModel.Labels = allLabels;

        this.isAlive$.next(true);
    }

    /********************************************************************************************
     * Private methods which interact with the Trello API to retrieve / manipulate remote data  *
     ********************************************************************************************/

    private async asyncGet(url: string): Promise<any> {
        this.numRequestsSent++;

        console.log("GET " + url);

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
        this.numRequestsSent++;

        console.log("PUT " + url);

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
        this.numRequestsSent++;

        console.log("POST " + url);

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
        this.numRequestsSent++;

        console.log("DELETE " + url);

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


}