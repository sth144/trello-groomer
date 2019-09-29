import { BoardModel, ICard, List, Checklist, CheckItem } from "./trello.interface";
import { ReplaySubject} from "rxjs";
import { first } from "rxjs/operators";
import * as request from "request";

export class BoardController<T extends BoardModel> {
    private isAlive$ = new ReplaySubject<boolean>(1);
    public isAlive = this.isAlive$.pipe(first()).toPromise();

    constructor(private boardModel: T, private secrets: { key: string, token: string }) { 
        this.buildModel();
    }

    public async addCard(opts: any): Promise<ICard> {
        return await this.asyncPost(`/cards?idList=${this.boardModel.lists.inbox.id}`, opts);
    }

    // TODO: pass in args to determine behavior
    public async updateTaskDependencies() {
        const checklists = this.boardModel.getChecklists();
        for (const checklistId of Object.keys(checklists)) {
            if (checklists[checklistId].name === "Test") {
                for (const checklistItem of checklists[checklistId].checkItems) {
                    let alreadyExists = false;
                    for (const name of this.boardModel.getAllCardNames()) {
                        if (checklistItem.name.indexOf(name) !== -1) {
                            alreadyExists = true;
                        } 
                    }
                    if (!alreadyExists && checklistItem.state !== "complete") {
                        const parentCard = this.boardModel.getCardById(checklists[checklistId].idCard);
                        const added = await this.addCard({
                            name: checklistItem.name,
                            due: parentCard.due,
                            idLabels: parentCard.idLabels
                        });                 
                        
                        /** change name of checklist item to include link */
                        await this.asyncDelete(`/checklists/${checklistId}/checkItems/${checklistItem.id}/`);
                        const replacedCheckItem = await this.asyncPost(`/checklists/${checklistId}/checkItems/`, {
                            name: `${checklistItem.name.split("https://")[0]} ${added.shortUrl}`
                        });

                        /** link added card to parent */
                        await this.asyncPost(`/cards/${added.id}/attachments`, {
                            name: `parent:${parentCard.id}|checklistId:${checklistId}|checkItemId:${replacedCheckItem.id}`,
                            url: parentCard.shortUrl
                        });
                    }
                } 
            }
        }
        /** if card completed, and part of checklist, check on checklist */
        for (const card of this.boardModel.getAllCards()) {
            if (card.dueComplete && card.badges.attachments > 0) {
                const attachments = await this.asyncGet(`/cards/${card.id}/attachments`);
                for (const attachment of attachments) {
                    if (attachment.name.indexOf("parent") !== -1) {
                        let info = attachment.name.split("|");
                        const parsed: any = {};
                        for (const item of info) {
                            const split = item.split(":");
                            const prop = split[0];
                            const val = split[1];
                            Object.assign(parsed, { [prop]: val });
                        }
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
        /** if checklist item completed, and has card, complete card */
        for (const checklistItem of this.boardModel.getAllChecklistItems()) {
            if (checklistItem.state === "complete") {
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

    private async buildModel(): Promise<void> {
        const listsOnBoard = await this.asyncGet(`/board/${this.boardModel.id}/lists`);
        for (const responseList of listsOnBoard) {
            for (const listNameToFetch of this.boardModel.getListNames()) {
                if (responseList.name.toLowerCase().indexOf(listNameToFetch) !== -1) {
                    Object.assign(this.boardModel.lists[listNameToFetch], { 
                        id: responseList.id,
                        name: responseList.name,
                        cards: []
                    });
                    this.boardModel.lists[listNameToFetch].cards 
                        = await this.asyncGet(`/lists/${responseList.id}/cards`);
                    
                }
            }
        };
        const checklistsOnBoard = await this.asyncGet(`/boards/${this.boardModel.id}/checklists`);
        for (const responseChecklist of checklistsOnBoard) {
            this.boardModel.checkLists[responseChecklist.id] = new Checklist();
            Object.assign(this.boardModel.checkLists[responseChecklist.id], {
                id: responseChecklist.id,
                name: responseChecklist.name,
                idCard: responseChecklist.idCard,
            });
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

    private getLongUrl(url: string): string {
        let end = `key=${this.secrets.key}&token=${this.secrets.token}`;
        if (url.indexOf("?") === -1) {
            end = "?".concat(end);
        } else {
            end = "&".concat(end);
        }
        return `https://api.trello.com/1${url}${end}`;
    }
}


