import { ICard } from "./card.interface";

/*************************************************************************************************
 * Selection logic for the "aggregator" cards the groomer maintains (Sprint, Groceries, Research *
 *  Tasks). Each of those boards has one card that is currently live, plus a long tail of         *
 *  archived copies in month lists. This module encodes which one is "current" so consumers       *
 *  (the read API) resolve the same card the groomer works on.                                    *
 *                                                                                               *
 * NOTE: src/groomer/todo/{sprint-items,grocery-list-items,research-tasks}.ts each still carry    *
 *  their own inlined copy of this selection. They are intentionally left alone here — folding    *
 *  them onto this module changes live grooming behavior and belongs in its own change.           *
 *************************************************************************************************/

/** Trello list names the current aggregator card may live in */
export const ACTIVE_LIST_NAMES = ["Inbox", "This Week", "Tomorrow", "Today"];

/** Trello list names that disqualify a card from being "current" */
export const EXCLUDED_LIST_NAMES = ["Done", "Backlog", "This Month"];

export interface CardQuery {
  /** stable key used in API routes */
  key: string;
  /** human label for the view */
  label: string;
  /**
   * cards whose name contains this tag are *inputs* to the aggregator (one-off cards the groomer
   *  folds into the checklist), never the aggregator card itself
   */
  itemTag: string;
  /** a candidate card's name must contain one of these */
  keywords: string[];
}

export const SPRINT_QUERY: CardQuery = {
  key: "sprint",
  label: "Sprint",
  itemTag: "[sprint item]",
  keywords: ["sprint", "sprints"],
};

export const GROCERIES_QUERY: CardQuery = {
  key: "groceries",
  label: "Groceries & Errands",
  itemTag: "[grocery list item]",
  keywords: ["grocery", "groceries"],
};

export const RESEARCH_QUERY: CardQuery = {
  key: "research",
  label: "Research Tasks",
  itemTag: "[research task]",
  keywords: ["research tasks", "research task", "research"],
};

export const CARD_QUERIES: CardQuery[] = [
  SPRINT_QUERY,
  GROCERIES_QUERY,
  RESEARCH_QUERY,
];

export function getCardQueryByKey(key: string): CardQuery | undefined {
  return CARD_QUERIES.filter((query) => query.key === key)[0];
}

/**
 * sort comparator placing the latest due date first, with undated cards last
 */
function byDueDateDescending(a: ICard, b: ICard): number {
  const timeA = a.due ? new Date(a.due).getTime() : NaN;
  const timeB = b.due ? new Date(b.due).getTime() : NaN;
  const aHasDue = !isNaN(timeA);
  const bHasDue = !isNaN(timeB);

  if (!aHasDue && !bHasDue) return 0;
  /** undated cards sink below dated ones */
  if (!aHasDue) return 1;
  if (!bHasDue) return -1;

  return timeB - timeA;
}

/**
 * returns every candidate aggregator card for `query`, most recently due first. Cards carrying the
 *  query's item tag are excluded, as are cards parked in Done / Backlog / This Month or in any
 *  list outside `ACTIVE_LIST_NAMES` (which is what keeps archived month copies out).
 *
 * @param cards every card on the board
 * @param listNamesById maps a Trello list id to its display name
 */
export function findCandidateCards(
  cards: ICard[],
  query: CardQuery,
  listNamesById: Record<string, string>
): ICard[] {
  return cards
    .filter((card) => typeof card.name === "string")
    .filter((card) => {
      const name = card.name.toLowerCase();
      return (
        name.indexOf(query.itemTag) === -1 &&
        query.keywords.some((keyword) => name.indexOf(keyword) !== -1)
      );
    })
    .filter((card) => {
      const listName = listNamesById[card.idList];
      return (
        listName !== undefined &&
        EXCLUDED_LIST_NAMES.indexOf(listName) === -1 &&
        ACTIVE_LIST_NAMES.indexOf(listName) !== -1
      );
    })
    .sort(byDueDateDescending);
}

/**
 * returns the single current aggregator card for `query`, or undefined when the groomer has not
 *  created one yet
 */
export function findCurrentCard(
  cards: ICard[],
  query: CardQuery,
  listNamesById: Record<string, string>
): ICard | undefined {
  return findCandidateCards(cards, query, listNamesById)[0];
}
