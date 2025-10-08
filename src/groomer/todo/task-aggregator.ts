import { BoardController } from "@base/controller/board.controller";
import { ToDoBoardModel } from "../todo.groomer";
import { CheckItem } from "@base/lib/checklist.interface";
import { ICard } from "@base/lib/card.interface"; /** (Importing ICard) */

const ITEM_TAG_PATTERN = /^\[.* item\]$/;

export async function processTaskAggregatorItems(
  todoController: BoardController<ToDoBoardModel>
): Promise<void> {
  const allCards: ICard[] =
    await todoController.BoardModel.getAllCards(); /** (Explicitly typing allCards) */

  /** (Find all cards that are not done and match ITEM_TAG_PATTERN) */
  const taskCards = allCards.filter(
    (card: ICard) => !card.dueComplete && ITEM_TAG_PATTERN.test(card.name)
  );

  /** (Group cards by the captured group in ITEM_TAG_PATTERN) */
  const groupedCards: Record<string, ICard[]> = taskCards.reduce(
    (acc: Record<string, ICard[]>, card: ICard) => {
      const match = ITEM_TAG_PATTERN.exec(card.name);
      if (match) {
        const groupKey =
          match[1]; /** (Assuming the first capturing group is the desired key) */
        if (!acc[groupKey]) {
          acc[groupKey] = [];
        }
        acc[groupKey].push(card);
      }
      return acc;
    },
    {}
  );

  for (const groupKey in groupedCards) {
    const cardsInGroup = groupedCards[groupKey];

    /** (Find or create the aggregator card) */
    const existingAggregatorCards = allCards.filter(
      (card: ICard) => card.name.toLowerCase() === groupKey.toLowerCase()
    );

    let aggregatorCard: ICard;
    if (existingAggregatorCards.length > 0) {
      /** (Use the soonest due card) */
      aggregatorCard = existingAggregatorCards.sort((a: ICard, b: ICard) => {
        return (
          (new Date(a.due) || new Date("1971-12-31")).getTime() -
          (new Date(b.due) || new Date("1971-12-31")).getTime()
        );
      })[0];
    } else {
      /** (Create a new aggregator card) */
      aggregatorCard = await createNewTaskAggregatorFromTemplate(
        todoController,
        groupKey.charAt(0).toUpperCase() +
          groupKey.slice(1) /** (Capitalize the group key) */,
        todoController.BoardModel.getListByName("This Month").id
      );
    }

    /** (Get or create a checklist for the aggregator card) */
    let checklists = await todoController.getChecklistsForCardId(
      aggregatorCard.id
    );
    let targetChecklist =
      checklists.length > 0
        ? checklists[0]
        : await todoController.addChecklistToCard(
            aggregatorCard.id,
            "Checklist"
          );

    /** (Add items to the checklist, ensuring no duplicates) */
    for (const card of cardsInGroup) {
      if (
        !targetChecklist.checkItems.some(
          (item: CheckItem) =>
            item.name.toLowerCase() === card.name.toLowerCase()
        )
      ) {
        await todoController.addCheckItemToChecklist(
          targetChecklist.id,
          card.name
        );
      }
    }

    /** (Roll over to a new card if more than 20 items and more than half complete) */
    const targetChecklistItemsComplete = targetChecklist.checkItems.filter(
      (item: CheckItem) => item.state === "complete"
    ).length;
    const targetChecklistTotalItems = targetChecklist.checkItems.length;

    if (
      targetChecklist.checkItems.length > 20 &&
      targetChecklistItemsComplete / targetChecklistTotalItems > 0.5
    ) {
      /** (Create a new card) */
      const newAggregatorCard = await createNewTaskAggregatorFromTemplate(
        todoController,
        groupKey.charAt(0).toUpperCase() +
          groupKey.slice(1) /** (Capitalize the group key) */,
        todoController.BoardModel.getListByName("This Month").id
      );

      /** (Get checklist on new card) */
      const newChecklist = await todoController.getChecklistsForCardId(
        newAggregatorCard.id
      );
      const targetNewChecklist = newChecklist[0];

      /** (Move "incomplete" state items from original card to the new checklist) */
      for (const checkItem of targetChecklist.checkItems) {
        if (checkItem.state === "incomplete") {
          await todoController.addCheckItemToChecklist(
            targetNewChecklist.id,
            checkItem.name
          );
          await todoController.removeCheckItemFromChecklist(
            targetChecklist.id,
            checkItem.id
          );
        }
      }
    }

    /** (Delete the original task cards) */
    for (const card of cardsInGroup) {
      await todoController.deleteCardByID(card.id);
    }
  }
}

async function createNewTaskAggregatorFromTemplate(
  todoController: BoardController<ToDoBoardModel>,
  domainName: string,
  thisMonthListId: string
) {
  const newCard = await todoController.addCard(
    {
      name: domainName,
      desc: `Auto-generated from task-aggregator.ts`,
      idList: thisMonthListId,
      pos: "top",
    },
    thisMonthListId,
    false
  );
  console.log("New Card");
  console.log(newCard);

  await todoController.addChecklistToCard(newCard.id, "Checklist");
  return newCard;
}
