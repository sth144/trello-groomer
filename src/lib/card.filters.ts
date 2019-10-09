import { ICard } from "./card.interface";
import { getNextWeekDay, Weekday } from "./date.utils";

export const cardIsComplete = (card: ICard) => {
    if (card.dueComplete) {
        return true;
    } return false;
}

export const cardDueToday = (card: ICard) => {
    if (cardHasDueDate(card)) {
        const dueDate = new Date(card.due);
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate()+1)
        return (+dueDate < +tomorrow); 
    } return false;
}

export const cardDueThisWeek = (card: ICard) => {
    if (cardHasDueDate(card)) {
        const dueDate = new Date(card.due);
        const nextSunday = getNextWeekDay(Weekday.Sunday);
        return (+dueDate <= +nextSunday);
    } return false;
}

export const cardDueThisMonth = (card: ICard) => {
    if (cardHasDueDate(card)) {
        const dueDate = new Date(card.due);
        const today = new Date();
        const firstOfNextMonth = new Date(today.getFullYear(), today.getMonth()+1, 1);
        return (+dueDate < +firstOfNextMonth);
    } return false;
}

export const cardHasDueDate = (card: ICard) => {
    if (card.due === null || card.due === undefined) return false;
    return true;
}

export const Not = (filter: (aCard: ICard) => boolean) => {
    return (card: ICard) => {
        const oppositeOfResult = filter(card);
        return !oppositeOfResult;
    }
}