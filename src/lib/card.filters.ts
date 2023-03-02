import { ICard, IAction } from "./card.interface";
import { getNextWeekDay, Weekday, diffBtwnDatesInDays } from "./date.utils";

export const cardIsComplete = (card: ICard) => {
  if (card.dueComplete) {
    return true;
  }
  return false;
};

export const cardDueToday = (card: ICard) => {
  if (cardHasDueDate(card)) {
    const dueDate = new Date(card.due);

    const midnightTonight = new Date();
    midnightTonight.setHours(24, 0, 0, 0);

    return +dueDate < +midnightTonight;
  }
  return false;
};

export const cardDueWithinTwoDays = (card: ICard) => {
  if (cardHasDueDate(card)) {
    const dueDate = new Date(card.due);
    const today = new Date();
    const dayAfterTomorrow = new Date();
    /** set to 3 so that today is taken into account */
    dayAfterTomorrow.setDate(today.getDate() + 3);
    return +dueDate < +dayAfterTomorrow;
  }
  return false;
};

export const cardDueThisWeek = (card: ICard) => {
  if (cardHasDueDate(card)) {
    const dueDate = new Date(card.due);
    const nextMonday = getNextWeekDay(Weekday.Monday);
    return +dueDate <= +nextMonday;
  }
  return false;
};

export const cardDueThisMonth = (card: ICard) => {
  if (cardHasDueDate(card)) {
    const dueDate = new Date(card.due);
    const today = new Date();
    const firstOfNextMonth = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      1
    );
    return +dueDate < +firstOfNextMonth;
  }
  return false;
};

export const cardHasDueDate = (card: ICard) => {
  if (card.due === null || card.due === undefined) return false;
  return true;
};

export const Not = (filter: (aCard: ICard) => boolean) => {
  return (card: ICard) => {
    const oppositeOfResult = filter(card);
    return !oppositeOfResult;
  };
};

export function wasMovedFromToListFilterFactory(
  toListId: string,
  fromListIds: string[]
) {
  return (card: ICard) => {
    const isMoveFromToAction = (action: IAction): boolean => {
      return (
        action.data.hasOwnProperty("listBefore") &&
        fromListIds.some(
          (id) => id === (<{ id: string }>action.data["listBefore"]).id
        ) &&
        action.data.hasOwnProperty("listAfter") &&
        (<{ id: string }>action.data["listAfter"]).id === toListId
      );
    };

    const isDueDateAction = (action: IAction): boolean => {
      return (
        action.data.hasOwnProperty("old") &&
        action.data["old"].hasOwnProperty("due")
      );
    };

    /** get a list of all card idList and due date change actions */
    const updateCardActions = card.actions
      .filter((x: IAction) => {
        return (
          x.type === "updateCard" &&
          /**
           * get all list movement actions where card was moved from one of the lists in
           *  fromListIds to toListId
           */ (isMoveFromToAction(x) ||
            /** grab due date assignment actions */
            isDueDateAction(x))
        );
      })
      .sort((a: IAction, b: IAction) => {
        /** sort the results with most recent first */
        const dateA = new Date(a.date),
          dateB = new Date(b.date);
        if (+dateA === +dateB) return 0;
        if (+dateA > +dateB) return -1;
        return 1;
      });

    let lastMoveActionIndex = null;
    let lastDueDateActionIndex = null;
    for (let i = 0; i < updateCardActions.length; i++) {
      if (
        lastMoveActionIndex === null &&
        isMoveFromToAction(updateCardActions[i])
      ) {
        lastMoveActionIndex = i;
      }
      if (
        lastDueDateActionIndex === null &&
        isDueDateAction(updateCardActions[i])
      ) {
        lastDueDateActionIndex = i;
      }
    }

    /**
     * if last time due date was changed was after last time card was moved
     */
    if (lastMoveActionIndex < lastDueDateActionIndex) {
      /** examine most recent due date assignment to determine return value */
      const oldDue = (<{ due: string }>(
        updateCardActions[lastDueDateActionIndex].data.old
      )).due;
      const newDue = (<{ due: string }>(
        updateCardActions[lastDueDateActionIndex].data.card
      )).due;
      if (newDue === null) {
        /** due date was removed, return false (caller should do nothing) */
        return false;
      } else {
        if (oldDue === null) {
          /** date was added for first time, return true (caller will perform action) */
          return true;
        } else {
          const lastDueActionDatePre = new Date(oldDue);
          const lastDueActionDatePost = new Date(newDue);
          if (+lastDueActionDatePost < +lastDueActionDatePre) {
            /** if most recent due date action moved to earlier date, return true */
            return true;
          }

          const now = new Date();
          if (
            diffBtwnDatesInDays(
              new Date(updateCardActions[lastDueDateActionIndex].date),
              now
            ) <= -7
          ) {
            /** if most recent due date action was more than 1 week ago */
            return true;
          }
          if (diffBtwnDatesInDays(lastDueActionDatePost, now) <= 0) {
            /** if new due date is in the past, that action is moot, return true */
            return true;
          }
          /** due date moved into future, return false below (don't perform any action) */
        }
      }
    }
    return false;
  };
}
