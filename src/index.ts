import { ToDoBoardModel } from "./todo.board.model";
import { BoardController } from "./board.controller";
import { ICard } from "./trello.interface";





const secrets = require("../key.json");
const model = new ToDoBoardModel("cK9nA9nR")
const controller = new BoardController<ToDoBoardModel>(model, { 
    key: secrets.key, 
    token: secrets.token 
});
controller.isAlive.then(async () => {
    // const express = require("express");
    // const app = express();
    // app.get("/", (req: any, res: any) => {
    //     res.send("HELLO");
    // });
    // app.listen(4500, () => console.log("LISTENING"));

    /** order is important here */
    await controller.moveCardsFromToIf([
        model.lists.inbox.id,
        model.lists.backlog.id, 
        model.lists.month.id, 
        model.lists.week.id,    
        model.lists.day.id 
    ], model.lists.done.id, cardIsComplete);

    await controller.moveCardsFromToIf([
        model.lists.inbox.id,
        model.lists.backlog.id, 
        model.lists.month.id, 
        model.lists.week.id,    
    ], model.lists.day.id, cardDueToday);
    
    await controller.moveCardsFromToIf([
        model.lists.month.id, 
    ], model.lists.week.id, cardDueThisWeek);

    await controller.moveCardsFromToIf([
        model.lists.inbox.id,
        model.lists.backlog.id, 
    ], model.lists.month.id, cardDueThisMonth);

    await controller.moveCardsFromToIf([
        model.lists.inbox.id
    ], model.lists.backlog.id, cardHasDueDate);

    await controller.updateTaskDependencies();
});

const cardIsComplete = (card: ICard) => {
    if (card.dueComplete) {
        return true;
    } return false;
}

const cardDueToday = (card: ICard) => {
    if (cardHasDueDate(card)) {
        const dueDate = new Date(card.due);
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate()+1)
        return (+dueDate < +tomorrow); 
    } return false;
}

const cardDueThisWeek = (card: ICard) => {
    if (cardHasDueDate(card)) {
        const dueDate = new Date(card.due);
        const today = new Date();
        const nextSunday = getNextWeekDay(today, Weekday.Sunday);
        return (+dueDate <= +nextSunday);
    } return false;
}

const cardDueThisMonth = (card: ICard) => {
    if (cardHasDueDate(card)) {
        const dueDate = new Date(card.due);
        const today = new Date();
        const firstOfNextMonth = new Date(today.getFullYear(), today.getMonth()+1, 1);
        return (+dueDate < +firstOfNextMonth);
    } return false;
}

const cardHasDueDate = (card: ICard) => {
    if (card.due === null || card.due === undefined) return false;
    return true;
}

enum Weekday {
    Sunday,
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
}

function getNextWeekDay(date: Date, dayOfWeek: Weekday): Date {
    const resultDate = new Date(date.getTime());
    resultDate.setDate(date.getDate() + (7 + dayOfWeek - date.getDay()) % 7);
    return resultDate;
}