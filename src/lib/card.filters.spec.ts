import { ICard } from "./card.interface";
import { cardDueToday } from "./card.filters";
import { expect } from "chai";

describe("Card filters", () => {
    describe("cardDueToday", () => {
        it("should return true for card due before midnight tonight", () => {
            const _11pmTonight = new Date();
            _11pmTonight.setHours(23,0,0,0);

            const cardToday: ICard = {
                id: Math.random().toString(32).substring(2,10),
                badges: [],
                name: Math.random().toString(32).substring(2,10),
                desc: Math.random().toString(32).substring(2,10),
                due: _11pmTonight.toUTCString(),
                dueComplete: false,
                dateLastActivity: (new Date()).toLocaleDateString(),
                idList: Math.random().toString(32).substring(2,10),
                idLabels: [],
                pos: Math.floor(Math.random() * 100),
                shortUrl: Math.random().toString(32).substring(2,10),
                attachments: [],
                actions: []
            };

            expect(cardDueToday(cardToday)).to.equal(true);
        });
        it("should return false for card due tomorrow", () => {
            const _11amTomorrow = new Date();
            _11amTomorrow.setDate(_11amTomorrow.getDate() + 1);
            _11amTomorrow.setHours(11,0,0,0);

            const cardTomorrow: ICard =  {
                id: Math.random().toString(32).substring(2,10),
                badges: [],
                name: Math.random().toString(32).substring(2,10),
                desc: Math.random().toString(32).substring(2,10),
                due: _11amTomorrow.toUTCString(),
                dueComplete: false,
                dateLastActivity: (new Date()).toLocaleDateString(),
                idList: Math.random().toString(32).substring(2,10),
                idLabels: [],
                pos: Math.floor(Math.random() * 100),
                shortUrl: Math.random().toString(32).substring(2,10),
                attachments: [],
                actions: []
            };

            expect(cardDueToday(cardTomorrow)).to.equal(false);
        });
    }); 
});