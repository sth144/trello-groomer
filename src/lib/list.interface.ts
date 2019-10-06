import { ICard } from "./card.interface";

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
