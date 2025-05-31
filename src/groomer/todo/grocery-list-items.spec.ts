import { processGroceryListItems } from './grocery-list-items';
import { CheckItem, Checklist } from '@base/lib/checklist.interface';

describe('processGroceryListItems (manual mocks)', () => {
  let mockTodoController: any;

  beforeEach(() => {
    mockTodoController = {
      BoardModel: {
        getAllCards: async () => [],
        getListByName: (name: string) => ({
          id: name.toLowerCase().replace(/\s/g, ''),
        }),
      },
      getChecklistsForCardId: async (cardId: string) => [],
      addChecklistToCard: async (cardId: string, title: string) => ({
        id: 'mockChecklistId',
        name: title,
        checkItems: [],
      }),
      addCard: async (
        cardData: any,
        listId: string,
        fromTemplate: boolean
      ) => ({
        id: 'newCardId',
        name: cardData.name,
      }),
      addCheckItemToChecklist: async (
        checklistId: string,
        itemName: string
      ) => {},
      removeCheckItemFromChecklist: async (
        checklistId: string,
        checkItemId: string
      ) => {},
      deleteCardByID: async (cardId: string) => {},
    };
  });

  it('creates a new grocery list card when none exist and checklist is empty', async () => {
    // simulate input card with "[Grocery List Item]" title and description
    const groceryItemCard = {
      name: '[Grocery List Item] milk',
      desc: 'Milk',
      id: 'groceryCard1',
    };

    // simulate all cards (only grocery item cards)
    mockTodoController.BoardModel.getAllCards = async () => [groceryItemCard];

    let addedItems: string[] = [];
    let deletedCards: string[] = [];

    mockTodoController.addCheckItemToChecklist = async (
      checklistId: string,
      itemName: string
    ) => {
      addedItems.push(itemName);
    };

    mockTodoController.deleteCardByID = async (cardId: string) => {
      deletedCards.push(cardId);
    };

    await processGroceryListItems(mockTodoController);

    expect(addedItems).toContain('Milk');
    expect(deletedCards).toContain('groceryCard1');
  });

  it('adds item to existing grocery list checklist', async () => {
    const existingCard = {
      name: 'Groceries',
      id: 'card1',
      due: new Date().toISOString(),
      idList: 'today',
    };

    const checklist: Checklist = {
      id: 'checklist1',
      name: 'Checklist',
      idCard: '0',
      checkItems: [],
    };

    mockTodoController.BoardModel.getAllCards = async () => [
      {
        name: '[Grocery List Item] eggs',
        desc: 'Eggs',
        id: 'groceryCard2',
      },
      existingCard,
    ];

    mockTodoController.getChecklistsForCardId = async () => [checklist];

    let addedItems: string[] = [];
    let deletedCards: string[] = [];

    mockTodoController.addCheckItemToChecklist = async (
      _id: string,
      name: string
    ) => {
      addedItems.push(name);
    };

    mockTodoController.deleteCardByID = async (cardId: string) => {
      deletedCards.push(cardId);
    };

    await processGroceryListItems(mockTodoController);

    expect(addedItems).toContain('Eggs');
    expect(deletedCards).toContain('groceryCard2');
  });

  it('does not add duplicate checklist items', async () => {
    const groceryItem = {
      name: '[Grocery List Item] Bread',
      desc: 'Bread',
      id: 'groceryCard3',
    };

    const groceryCard = {
      name: 'Groceries',
      id: 'card3',
      due: new Date().toISOString(),
      idList: 'today',
    };

    const checklist = {
      id: 'checklist2',
      name: 'Checklist',
      checkItems: [
        {
          id: 'item1',
          name: 'Bread',
          state: 'incomplete',
        },
      ],
    };

    mockTodoController.BoardModel.getAllCards = async () => [
      groceryItem,
      groceryCard,
    ];

    mockTodoController.getChecklistsForCardId = async () => [checklist];

    let addedItems: string[] = [];
    let deletedCards: string[] = [];

    mockTodoController.addCheckItemToChecklist = async (
      _id: string,
      name: string
    ) => {
      addedItems.push(name);
    };

    mockTodoController.deleteCardByID = async (cardId: string) => {
      deletedCards.push(cardId);
    };

    await processGroceryListItems(mockTodoController);

    expect(addedItems).not.toContain('Bread'); // already exists
    expect(deletedCards).not.toContain('groceryCard3'); // description already matched
  });
});
