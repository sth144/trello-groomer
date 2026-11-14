import { expect } from "chai";
import { processTaskAggregatorItems } from "./task-aggregator";

describe("processTaskAggregatorItems", () => {
  it("sorts generated aggregator checklists even without new item cards", async () => {
    const sorted: string[] = [];
    const controller: any = {
      BoardModel: {
        getAllCards: () => [
          {
            id: "aggregator",
            name: "Projects",
            desc: "Auto-generated from task-aggregator.ts, domain Projects",
            dueComplete: false,
          },
          { id: "ordinary", name: "Other", desc: "Manual card", dueComplete: false },
        ],
      },
      getChecklistsForCardId: async (cardId: string) =>
        cardId === "aggregator" ? [{ id: "first" }, { id: "second" }] : [],
      sortChecklistIncompleteFirst: async (cardId: string, checklistId: string) => {
        sorted.push(`${cardId}:${checklistId}`);
      },
    };

    await processTaskAggregatorItems(controller);

    expect(sorted).to.deep.equal(["aggregator:first", "aggregator:second"]);
  });

  it("sorts an existing aggregator after adding incoming items", async () => {
    const calls: string[] = [];
    const controller: any = {
      BoardModel: {
        getAllCards: () => [
          { id: "item", name: "[projects item]", desc: "New task", dueComplete: false },
          { id: "aggregator", name: "Projects", desc: "Manual card", dueComplete: false },
        ],
      },
      getChecklistsForCardId: async () => [
        { id: "checklist", checkItems: [] as any[] },
      ],
      addCheckItemToChecklist: async () => calls.push("add"),
      deleteCardByID: async () => calls.push("delete"),
      sortChecklistIncompleteFirst: async () => calls.push("sort"),
    };

    await processTaskAggregatorItems(controller);

    expect(calls).to.deep.equal(["add", "delete", "sort"]);
  });
});
