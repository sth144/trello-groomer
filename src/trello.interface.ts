export interface ICard {
    id: string,
    badges: any,
    name: string,
    due: string,
    dueComplete: boolean,
    idList: string,
    idLabels: string[],
    pos: number,
    shortUrl: string
}

export class CheckItem {
    id: string = "";
    idChecklist: string = "";
    name: string = "";
    state: string = "";
}

export class Checklist {
    id: string = "";
    name: string = "";
    idCard: string = ""
    checkItems: CheckItem[] = []
}

export class List {
    id: string = "";
    name: string = "";
    cards: ICard[] = [];
    getCardIds(): string[] {
        return Object.keys(this.cards)
    }
    getCardNames(): string[] {
        return this.getCards().map(x => x.name);
    }
    getCards(): ICard[] {
        return this.cards;
    }
}

export class BoardModel {
    id: string = "";
    /** lists indexed by name, not id */
    lists: {    
        [name: string]: List;
    } = {};
    checkLists: {
        [id: string]: Checklist
    } = {};
    getAllCards(): ICard[] {
        let allCards: ICard[] = [];
        for (const listName in this.lists) {
            allCards = allCards.concat(...this.lists[listName].getCards());
        }
        return allCards;
    }
    getAllCardNames(): string[] {
        let allNames: string[] = [];
        for (const listName in this.lists) {
            allNames = allNames.concat(...this.lists[listName].getCardNames());
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
}
