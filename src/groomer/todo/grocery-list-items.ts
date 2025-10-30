import { BoardController } from "@base/controller/board.controller";
import { ToDoBoardModel } from "../todo.groomer";
import { CheckItem } from "@base/lib/checklist.interface";
const boards = require("../../../config/boards.json");

const GROCERY_LIST_ITEM_TAG = "[grocery list item]";
const GROCERY_LIST_CARD_KEYWORDS = ["grocery", "groceries"];

export async function processGroceryListItems(
  todoController: BoardController<ToDoBoardModel>
): Promise<void> {
  const allCards = await todoController.BoardModel.getAllCards();

  /** get a list of all cards with title [Grocery List Item] */
  const groceryListItemCards = allCards.filter((card) =>
    card.name.toLowerCase().includes(GROCERY_LIST_ITEM_TAG)
  );

  /** extract descriptions from each */
  const groceryListItems = groceryListItemCards.map((card) => card.desc);

  // TODO: filter out DONE
  const doneListId = todoController.BoardModel.getListByName("Done").id;
  const backlogListId = todoController.BoardModel.getListByName("Backlog").id;
  const thisMonthListId =
    todoController.BoardModel.getListByName("This Month").id;
  const inboxListId = todoController.BoardModel.getListByName("Inbox").id;
  const thisWeekListId =
    todoController.BoardModel.getListByName("This Week").id;
  const tomorrowListId = todoController.BoardModel.getListByName("Tomorrow").id;
  const todayListId = todoController.BoardModel.getListByName("Today").id;

  /** locate latest/soonest due card with "Grocery" or "Groceries" in title */
  const existingGroceryListCards = allCards
    .filter((card) => {
      const lowerCaseName = card.name.toLowerCase();
      return (
        !lowerCaseName.includes(GROCERY_LIST_ITEM_TAG) &&
        GROCERY_LIST_CARD_KEYWORDS.some((keyword) =>
          lowerCaseName.includes(keyword)
        )
      );
    })
    .filter((card) => card.idList !== doneListId)
    // ignore cards in backlog or month
    .filter((card) => card.idList !== backlogListId)
    .filter((card) => card.idList !== thisMonthListId)
    .filter((card) => {
      return [
        inboxListId,
        thisWeekListId,
        tomorrowListId,
        todayListId,
      ].includes(card.idList);
    })
    // .filter((card) => {
    //   const cardDue = new Date(card.due);
    //   return cardDue < currentDate;
    // })
    // .filter((card) => card.idBoard === boards.todo.id)
    .sort((A, B) => {
      const dateA = A.due || new Date("1971-12-31"); // If dueDate is null/undefined, set it to a future date
      const dateB = B.due || new Date("1971-12-31");
      if (dateA > dateB) {
        return -1;
      } else if (dateB < dateA) {
        return 1;
      }
      return 0;
    });
  console.log("Grocery Lists");
  console.log(existingGroceryListCards);

  let latestDueGroceryListCard = null;
  if (existingGroceryListCards.length > 0) {
    latestDueGroceryListCard = existingGroceryListCards[0];
  }

  if (!latestDueGroceryListCard) {
    /** if no card found, create from template */
    console.log("No card found, creating card in list");
    console.log(tomorrowListId);
    latestDueGroceryListCard = await createNewGroceryListCardFromTemplate(
      todoController,
      tomorrowListId
    );

    console.log(latestDueGroceryListCard);
  }

  console.log("Getting checklists from grocery card");

  /** find a checklist within grocery card */

  let checklists = await todoController.getChecklistsForCardId(
    latestDueGroceryListCard.id
  );

  console.log("Got checklists:");
  console.log(checklists);

  if (checklists.length === 0) {
    // if no checklist found, create one!!! and update checklists var

    console.log("Adding new checklist");
    const newChecklist = await todoController.addChecklistToCard(
      latestDueGroceryListCard.id,
      "Checklist"
    );
    console.log("Successfully added new checklist");

    checklists = [newChecklist];
  }

  let targetChecklist = checklists[0];

  let targetChecklistItemsComplete = targetChecklist.checkItems.filter(
    (item: CheckItem) => item.state === "complete"
  ).length;
  let targetChecklistTotalItems = targetChecklist.checkItems.length;

  /** roll over to a new card if more than 20 items and more than half complete */
  if (
    targetChecklist.checkItems.length > 20 &&
    targetChecklistItemsComplete / targetChecklistTotalItems > 0.5
  ) {
    /** create a new card */
    latestDueGroceryListCard = await createNewGroceryListCardFromTemplate(
      todoController,
      tomorrowListId
    );

    let originalChecklist = targetChecklist;

    /** get checklist on new card */
    targetChecklist = (
      await todoController.getChecklistsForCardId(latestDueGroceryListCard.id)
    )[0];

    /** move "incomplete" state items from original card to a new checklist */
    originalChecklist.checkItems.forEach(async (checkItem: CheckItem) => {
      if (checkItem.state === "incomplete") {
        try {
          await todoController.addCheckItemToChecklist(
            targetChecklist.id,
            checkItem.name
          );

          /** delete incomplete state items from original card checklist */
          await todoController.removeCheckItemFromChecklist(
            originalChecklist.id,
            checkItem.id
          );
        } catch (e) {
          console.log(
            `Failed to move checklist item: ${JSON.stringify(checkItem)}`
          );
        }
      }
    });
  }

  const itemsToDeleteCardFor = [];

  /** add items if they're not there */
  for (const newItem of groceryListItems) {
    console.log(`Adding item ${newItem} to checklist ${targetChecklist.name}`);
    if (
      !targetChecklist.checkItems.some(
        (item: CheckItem) => item.name.toLowerCase() === newItem.toLowerCase()
      )
    ) {
      console.log(`Adding item ${newItem} to checklist ${targetChecklist.id}`);
      await todoController.addCheckItemToChecklist(targetChecklist.id, newItem);
      itemsToDeleteCardFor.push(newItem);
    }
  }

  /** delete [Grocery List Item] cards */
  for (const card of groceryListItemCards) {
    if (
      itemsToDeleteCardFor.some((item) =>
        card.desc.toLowerCase().includes(item.toLowerCase())
      )
    ) {
      console.log(`Deleting card ${card.id}`);
      todoController.deleteCardByID(card.id);
    }
  }

  /** sort target checklist */
  console.log("Sorting checklist items");
  await todoController.sortChecklistIncompleteFirst(targetChecklist.id);

  console.log("Deduplicating checklist items");
  await todoController.deduplicateChecklistItems(targetChecklist.id);
}

async function createNewGroceryListCardFromTemplate(
  todoController: BoardController<ToDoBoardModel>,
  tomorrowListId: string
) {
  const newCard = await todoController.addCard(
    {
      name: "Groceries & Errands",
    },
    tomorrowListId,
    false
  );

  console.log("New Card");
  console.log(newCard);

  await todoController.addChecklistToCard(newCard.id, "Checklist");
  await todoController.addChecklistToCard(newCard.id, "Stores");

  return newCard;
}
