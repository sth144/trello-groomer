import { processResearchTasks } from './research-tasks';
import { CheckItem, Checklist } from '@base/lib/checklist.interface';
import { expect } from 'chai';

describe('processResearchTasks (manual mocks)', () => {
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

  it('creates a new research task card when none exist and checklist is empty', async () => {
    // simulate input card with "[research task]" title and description
    const researchTaskCard = {
      name: '[research task] quantum computing',
      desc: 'Research quantum computing basics',
      id: 'researchCard1',
    };

    // simulate all cards (only research task cards)
    mockTodoController.BoardModel.getAllCards = async () => [researchTaskCard];

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

    await processResearchTasks(mockTodoController);

    expect(addedItems).toContain('Research quantum computing basics');
    expect(deletedCards).toContain('researchCard1');
  });

  it('adds item to existing research task checklist', async () => {
    const existingCard = {
      name: 'Research Tasks',
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
        name: '[research task] machine learning',
        desc: 'Explore machine learning frameworks',
        id: 'researchCard2',
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

    await processResearchTasks(mockTodoController);

    expect(addedItems).toContain('Explore machine learning frameworks');
    expect(deletedCards).toContain('researchCard2');
  });

  it('does not add duplicate checklist items', async () => {
    const researchTaskCard = {
      name: '[research task] blockchain',
      desc: 'Blockchain fundamentals',
      id: 'researchCard3',
    };

    const researchCard = {
      name: 'Research Tasks',
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
          name: 'Blockchain fundamentals',
          state: 'incomplete',
        },
      ],
    };

    mockTodoController.BoardModel.getAllCards = async () => [
      researchTaskCard,
      researchCard,
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

    await processResearchTasks(mockTodoController);

    expect(addedItems).not.toContain('Blockchain fundamentals'); // already exists
    expect(deletedCards).not.toContain('researchCard3'); // description already matched
  });
});
