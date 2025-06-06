import { processResearchTasks } from "./research-tasks";
import { CheckItem, Checklist } from "@base/lib/checklist.interface";
import { expect } from "chai";

describe("processResearchTasks (manual mocks)", () => {
  let mockTodoController: any;

  beforeEach(() => {
    mockTodoController = {
      BoardModel: {
        getAllCards: async (): Promise<any[]> => [],
        getListByName: (name: string): { id: string } => ({
          id: name.toLowerCase().replace(/\s/g, ""),
        }),
      },
      getChecklistsForCardId: async (_: string): Promise<Checklist[]> => [],
      addChecklistToCard: async (
        _cardId: string,
        title: string
      ): Promise<Checklist> => ({
        id: "mockChecklistId",
        name: title,
        checkItems: [] as CheckItem[],
        idCard: Math.random().toString(36),
      }),
      addCard: async (
        cardData: any,
        _listId: string,
        _fromTemplate: boolean
      ): Promise<any> => ({
        id: "newCardId",
        name: cardData.name,
      }),
      addCheckItemToChecklist: async (
        _checklistId: string,
        _itemName: string
      ): Promise<void> => {},
      removeCheckItemFromChecklist: async (
        _checklistId: string,
        _checkItemId: string
      ): Promise<void> => {},
      deleteCardByID: async (_cardId: string): Promise<void> => {},
    };
  });

  it("creates a new research task card when none exist and checklist is empty", async () => {
    const researchTaskCard = {
      name: "[research task] quantum computing",
      desc: "Research quantum computing basics",
      id: "researchCard1",
    };

    mockTodoController.BoardModel.getAllCards = async (): Promise<any[]> => [
      researchTaskCard,
    ];

    const addedItems: string[] = [];
    const deletedCards: string[] = [];

    mockTodoController.addCheckItemToChecklist = async (
      _id: string,
      name: string
    ): Promise<void> => {
      addedItems.push(name);
    };

    mockTodoController.deleteCardByID = async (
      cardId: string
    ): Promise<void> => {
      deletedCards.push(cardId);
    };

    await processResearchTasks(mockTodoController);

    expect(addedItems).to.contain("Research quantum computing basics");
    expect(deletedCards).to.contain("researchCard1");
  });

  it("adds item to existing research task checklist", async () => {
    const existingCard = {
      name: "Research Tasks",
      id: "card1",
      due: new Date().toISOString(),
      idList: "today",
    };

    const checklist: Checklist = {
      id: "checklist1",
      name: "Checklist",
      idCard: "0",
      checkItems: [] as CheckItem[],
    };

    mockTodoController.BoardModel.getAllCards = async (): Promise<any[]> => [
      {
        name: "[research task] machine learning",
        desc: "Explore machine learning frameworks",
        id: "researchCard2",
      },
      existingCard,
    ];

    mockTodoController.getChecklistsForCardId = async (): Promise<
      Checklist[]
    > => [checklist];

    const addedItems: string[] = [];
    const deletedCards: string[] = [];

    mockTodoController.addCheckItemToChecklist = async (
      _id: string,
      name: string
    ): Promise<void> => {
      addedItems.push(name);
    };

    mockTodoController.deleteCardByID = async (
      cardId: string
    ): Promise<void> => {
      deletedCards.push(cardId);
    };

    await processResearchTasks(mockTodoController);

    expect(addedItems).to.contain("Explore machine learning frameworks");
    expect(deletedCards).to.contain("researchCard2");
  });

  it("does not add duplicate checklist items", async () => {
    const researchTaskCard = {
      name: "[research task] blockchain",
      desc: "Blockchain fundamentals",
      id: "researchCard3",
    };

    const researchCard = {
      name: "Research Tasks",
      id: "card3",
      due: new Date().toISOString(),
      idList: "today",
    };

    const checklist: Checklist = {
      id: "checklist2",
      name: "Checklist",
      idCard: "card3",
      checkItems: [
        {
          id: "item1",
          name: "Blockchain fundamentals",
          state: "incomplete",
        },
      ] as CheckItem[],
    };

    mockTodoController.BoardModel.getAllCards = async (): Promise<any[]> => [
      researchTaskCard,
      researchCard,
    ];

    mockTodoController.getChecklistsForCardId = async (): Promise<
      Checklist[]
    > => [checklist];

    const addedItems: string[] = [];
    const deletedCards: string[] = [];

    mockTodoController.addCheckItemToChecklist = async (
      _id: string,
      name: string
    ): Promise<void> => {
      addedItems.push(name);
    };

    mockTodoController.deleteCardByID = async (
      cardId: string
    ): Promise<void> => {
      deletedCards.push(cardId);
    };

    await processResearchTasks(mockTodoController);

    expect(addedItems).to.not.contain("Blockchain fundamentals"); // already exists
    expect(deletedCards).to.not.contain("researchCard3"); // description already matched
  });
});
