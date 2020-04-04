import { List } from "../lib/list.interface";
import { Checklist, CheckItem } from "../lib/checklist.interface";
import { ICard } from "../lib/card.interface";

export class BoardModel {
    protected _id: string = "";
    public get id(): string {
        return this._id;
    }
    /** lists indexed by name, not id */
    protected lists: {    
        [name: string]: List;
    } = {};
    protected checkLists: {
        [id: string]: Checklist
    } = {};
    protected labels: {
        [name: string]: string
    } = {};
    public set Labels(obj: { [name: string]: string }) {
        this.labels = obj;
    }
    getAllCards(): ICard[] {
        let allCards: ICard[] = [];
        for (const listName in this.lists) {
            allCards = allCards.concat(this.lists[listName].getCards());
        }
        return allCards.filter(x => x !== undefined);
    }
    getAllCardNames(): string[] {
        let allNames: string[] = [];
        for (const listName in this.lists) {
            allNames = allNames.concat(this.lists[listName].getCardNames());
        }
        return allNames;
    }
    getCardById(id: string): ICard {
        for (const list of this.getListsAsArray()) {
            for (const card of list.cards) {
                if (card.id === id) {
                    return card;
                }
            }
        }
    }
    getCardByName(name: string): ICard {
        for (const list of this.getListsAsArray()) {
            for (const card of list.cards) {
                if (card.name === name) {
                    return card;
                }
            }
        }
    }
    getListById(id: string): List {
        for (const list of this.getListsAsArray()) {
            if (list.id === id) {
                return list;
            }
        }
    }
    getListIds(): string[] {
        return this.getListsAsArray().map(x => x.id);
    }
    getListNames(): string[] {
        return Object.keys(this.lists);
    }
    getLists(): object {
        return this.lists;
    }
    getListsAsArray(): List[] {
        const result = [];
        for (const name of this.getListNames()) {
            result.push(this.lists[name]);
        }
        return result;
    }
    getChecklistIds(): string[] {
        return Object.keys(this.checkLists);
    }
    getChecklists(): { [id: string]: Checklist } {
        return this.checkLists;
    }
    getChecklistsAsArray(): Checklist[] {
        const result = [];
        for (const id of this.getChecklistIds()) {
            result.push(this.checkLists[id]);
        }
        return result;
    }
    getAllChecklistItems(): CheckItem[] {
        let result: CheckItem[] = [];
        for (const checklist of this.getChecklistsAsArray()) {
            result = result.concat(checklist.checkItems);
        }
        return result;
    }
    getLabels() {
        return this.labels;
    }
}
