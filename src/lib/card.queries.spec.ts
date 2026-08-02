import { expect } from "chai";
import { ICard } from "./card.interface";
import {
  GROCERIES_QUERY,
  RESEARCH_QUERY,
  SPRINT_QUERY,
  findCandidateCards,
  findCurrentCard,
  getCardQueryByKey,
} from "./card.queries";

const LIST_IDS = {
  today: "list-today",
  tomorrow: "list-tomorrow",
  week: "list-week",
  inbox: "list-inbox",
  done: "list-done",
  backlog: "list-backlog",
  month: "list-month",
  archive: "list-archive",
};

const LIST_NAMES: Record<string, string> = {
  [LIST_IDS.today]: "Today",
  [LIST_IDS.tomorrow]: "Tomorrow",
  [LIST_IDS.week]: "This Week",
  [LIST_IDS.inbox]: "Inbox",
  [LIST_IDS.done]: "Done",
  [LIST_IDS.backlog]: "Backlog",
  [LIST_IDS.month]: "This Month",
  [LIST_IDS.archive]: "June 2026 (ToDo)",
};

function card(partial: Partial<ICard>): ICard {
  return Object.assign(
    {
      id: "id",
      name: "",
      desc: "",
      due: null,
      dueComplete: false,
      dateLastActivity: "",
      idList: LIST_IDS.today,
      idLabels: [],
      idBoard: "board",
      pos: 0,
      shortUrl: "",
      attachments: [],
      actions: [],
      badges: {},
    },
    partial
  ) as ICard;
}

describe("card.queries", () => {
  describe("findCurrentCard", () => {
    it("picks the latest due card matching the query keywords", () => {
      const cards = [
        card({ id: "old", name: "Sprint", due: "2026-06-01T00:00:00.000Z" }),
        card({ id: "new", name: "Sprint", due: "2026-06-27T00:00:00.000Z" }),
        card({ id: "mid", name: "Sprint", due: "2026-06-14T00:00:00.000Z" }),
      ];

      const result = findCurrentCard(cards, SPRINT_QUERY, LIST_NAMES);

      expect(result.id).to.equal("new");
    });

    it("ignores archived copies parked in month lists", () => {
      const cards = [
        card({
          id: "archived",
          name: "Sprint",
          due: "2026-12-31T00:00:00.000Z",
          idList: LIST_IDS.archive,
        }),
        card({ id: "live", name: "Sprint", due: "2026-06-01T00:00:00.000Z" }),
      ];

      const result = findCurrentCard(cards, SPRINT_QUERY, LIST_NAMES);

      expect(result.id).to.equal("live");
    });

    it("ignores cards in Done, Backlog and This Month", () => {
      for (const idList of [LIST_IDS.done, LIST_IDS.backlog, LIST_IDS.month]) {
        const cards = [
          card({ id: "excluded", name: "Sprint", idList, due: "2026-08-01T00:00:00.000Z" }),
        ];

        expect(findCurrentCard(cards, SPRINT_QUERY, LIST_NAMES)).to.equal(
          undefined
        );
      }
    });

    it("never selects the groomer's own input cards", () => {
      const cards = [
        card({ id: "input", name: "[Sprint Item] ship the thing" }),
        card({ id: "aggregator", name: "Sprint" }),
      ];

      const result = findCurrentCard(cards, SPRINT_QUERY, LIST_NAMES);

      expect(result.id).to.equal("aggregator");
    });

    it("returns undefined when the groomer has not created a card yet", () => {
      const cards = [card({ id: "unrelated", name: "Take out the bins" })];

      expect(findCurrentCard(cards, GROCERIES_QUERY, LIST_NAMES)).to.equal(
        undefined
      );
    });

    it("matches the groceries card under either name", () => {
      for (const name of ["Groceries ", "Groceries & Errands", "Grocery run"]) {
        const result = findCurrentCard(
          [card({ id: "g", name })],
          GROCERIES_QUERY,
          LIST_NAMES
        );
        expect(result, `should match "${name}"`).to.not.equal(undefined);
      }
    });

    it("sorts undated cards below dated ones", () => {
      const cards = [
        card({ id: "undated", name: "Research Tasks", due: null }),
        card({ id: "dated", name: "Research Tasks", due: "2026-01-01T00:00:00.000Z" }),
      ];

      const result = findCurrentCard(cards, RESEARCH_QUERY, LIST_NAMES);

      expect(result.id).to.equal("dated");
    });

    it("tolerates cards sitting in a list the snapshot does not know", () => {
      const cards = [card({ id: "orphan", name: "Sprint", idList: "gone" })];

      expect(findCurrentCard(cards, SPRINT_QUERY, LIST_NAMES)).to.equal(
        undefined
      );
    });
  });

  describe("findCandidateCards", () => {
    it("returns every live candidate, newest first", () => {
      const cards = [
        card({ id: "a", name: "Sprint", due: "2026-06-01T00:00:00.000Z" }),
        card({
          id: "b",
          name: "Sprint",
          due: "2026-07-01T00:00:00.000Z",
          idList: LIST_IDS.tomorrow,
        }),
        card({ id: "c", name: "Sprint", idList: LIST_IDS.done }),
      ];

      const result = findCandidateCards(cards, SPRINT_QUERY, LIST_NAMES);

      expect(result.map((x) => x.id)).to.deep.equal(["b", "a"]);
    });
  });

  describe("getCardQueryByKey", () => {
    it("resolves the three known views", () => {
      expect(getCardQueryByKey("sprint").label).to.equal("Sprint");
      expect(getCardQueryByKey("groceries").label).to.equal(
        "Groceries & Errands"
      );
      expect(getCardQueryByKey("research").label).to.equal("Research Tasks");
    });

    it("returns undefined for anything else", () => {
      expect(getCardQueryByKey("nope")).to.equal(undefined);
    });
  });
});
