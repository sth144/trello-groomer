import { BoardController } from '@base/controller/board.controller';
import { ToDoBoardModel } from '../todo.groomer';
import { CheckItem } from '@base/lib/checklist.interface';

const RESEARCH_TASK_TAG = '[research task]';
const RESEARCH_TASK_CARD_KEYWORDS = ['research tasks', 'research'];

export async function processResearchTasks(
  todoController: BoardController<ToDoBoardModel>
): Promise<void> {
  const allCards = await todoController.BoardModel.getAllCards();

  /** get a list of all cards with title [research task] */
  const researchTaskCards = allCards.filter((card) =>
    card.name.toLowerCase().includes(RESEARCH_TASK_TAG)
  );

  /** extract descriptions from each */
  const researchTaskItems = researchTaskCards.map((card) => card.desc);

  console.log('Research task items');
  console.log(researchTaskCards);

  const doneListId = todoController.BoardModel.getListByName('Done').id;
  const backlogListId = todoController.BoardModel.getListByName('Backlog').id;
  const thisMonthListId =
    todoController.BoardModel.getListByName('This Month').id;
  const inboxListId = todoController.BoardModel.getListByName('Inbox').id;
  const thisWeekListId =
    todoController.BoardModel.getListByName('This Week').id;
  const tomorrowListId = todoController.BoardModel.getListByName('Tomorrow').id;
  const todayListId = todoController.BoardModel.getListByName('Today').id;

  /** locate latest/soonest due card with "Research Tasks" in title */
  const existingResearchTaskCards = allCards
    .filter((card) => {
      const lowerCaseName = card.name.toLowerCase();
      return (
        !lowerCaseName.includes(RESEARCH_TASK_TAG) &&
        RESEARCH_TASK_CARD_KEYWORDS.some((keyword) =>
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
    .sort((A, B) => {
      const dateA = A.due || new Date('1971-12-31'); // If dueDate is null/undefined, set it to a future date
      const dateB = B.due || new Date('1971-12-31');
      if (dateA > dateB) {
        return -1;
      } else if (dateB < dateA) {
        return 1;
      }
      return 0;
    });
  console.log('Research Task Cards');
  console.log(existingResearchTaskCards);

  let latestDueResearchTaskCard = null;
  if (existingResearchTaskCards.length > 0) {
    latestDueResearchTaskCard = existingResearchTaskCards[0];
  }

  if (!latestDueResearchTaskCard) {
    /** if no card found, create from template */
    console.log('No card found, creating card in list');
    console.log(tomorrowListId);
    latestDueResearchTaskCard = await createNewResearchTaskCardFromTemplate(
      todoController,
      tomorrowListId
    );

    console.log(latestDueResearchTaskCard);
  }

  console.log('Getting checklists from research task card');

  /** find a checklist within research task card */
  let checklists = await todoController.getChecklistsForCardId(
    latestDueResearchTaskCard.id
  );

  console.log('Got checklists:');
  console.log(checklists);

  if (checklists.length === 0) {
    // if no checklist found, create one!!! and update checklists var
    console.log('Adding new checklist');
    const newChecklist = await todoController.addChecklistToCard(
      latestDueResearchTaskCard.id,
      'Checklist'
    );
    console.log('Successfully added new checklist');

    checklists = [newChecklist];
  }

  let targetChecklist = checklists[0];

  let targetChecklistItemsComplete = targetChecklist.checkItems.filter(
    (item: CheckItem) => item.state === 'complete'
  ).length;
  let targetChecklistTotalItems = targetChecklist.checkItems.length;

  console.log(
    `${targetChecklistItemsComplete} / ${targetChecklistTotalItems} research tasks complete`
  );

  /** roll over to a new card if more than 20 items and more than half complete */
  if (
    targetChecklist.checkItems.length > 20 &&
    targetChecklistItemsComplete / targetChecklistTotalItems > 0.5
  ) {
    console.log(`Creating new research task card and checklist`);
    /** create a new card */
    latestDueResearchTaskCard = await createNewResearchTaskCardFromTemplate(
      todoController,
      tomorrowListId
    );

    let originalChecklist = targetChecklist;

    /** get checklist on new card */
    targetChecklist = (
      await todoController.getChecklistsForCardId(latestDueResearchTaskCard.id)
    )[0];

    /** move "incomplete" state items from original card to a new checklist */
    originalChecklist.checkItems.forEach(async (checkItem: CheckItem) => {
      if (checkItem.state === 'incomplete') {
        console.log(`Migrating checklist item ${checkItem.name}`);
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
  for (const newItem of researchTaskItems) {
    console.log(`Adding item ${newItem} to checklist ${targetChecklist.name}`);
    if (
      !targetChecklist.checkItems.some((item: CheckItem) =>
        item.name.toLowerCase().includes(newItem.toLowerCase())
      )
    ) {
      console.log(`Adding item ${newItem} to checklist ${targetChecklist.id}`);
      await todoController.addCheckItemToChecklist(targetChecklist.id, newItem);
      itemsToDeleteCardFor.push(newItem);
    }
  }

  /** delete [Research Task] cards */
  for (const card of researchTaskCards) {
    if (
      itemsToDeleteCardFor.some((item) =>
        card.desc.toLowerCase().includes(item.toLowerCase())
      )
    ) {
      console.log(`Deleting card ${card.id}`);
      todoController.deleteCardByID(card.id);
    }
  }
}

async function createNewResearchTaskCardFromTemplate(
  todoController: BoardController<ToDoBoardModel>,
  tomorrowListId: string
) {
  const newCard = await todoController.addCard(
    {
      name: 'Research Tasks',
    },
    tomorrowListId,
    false
  );

  console.log('New Card');
  console.log(newCard);

  await todoController.addChecklistToCard(newCard.id, 'Checklist');

  return newCard;
}
