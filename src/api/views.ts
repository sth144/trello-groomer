import { Snapshot } from "./snapshot.store";
import { WriteOverlay } from "./write.overlay";
import { CheckItem } from "../lib/checklist.interface";
import { ICard } from "../lib/card.interface";
import {
  CardQuery,
  CARD_QUERIES,
  GROCERIES_QUERY,
  findCurrentCard,
} from "../lib/card.queries";

/*************************************************************************************************
 * "Views" are the resolved aggregator cards (Sprint, Groceries & Errands, Research Tasks) with    *
 *  their checklists, which is what a client actually wants — as opposed to a raw board dump.      *
 *                                                                                               *
 * On top of those, every card sitting in the Today list that carries a checklist gets a view of   *
 *  its own, so a one-off card with a checklist on it shows up on the dashboard without the        *
 *  groomer having to fold it into an aggregator first.                                            *
 *************************************************************************************************/

/** cards in this list contribute a view each, on top of the aggregators */
const TODAY_LIST_NAME = "Today";

export interface ViewCheckItem {
  id: string;
  name: string;
  state: string;
}

export interface ViewChecklist {
  id: string;
  name: string;
  /** the card id is needed to toggle items — Trello keys that write off the card */
  cardId: string;
  total: number;
  complete: number;
  checkItems: ViewCheckItem[];
}

export interface ViewCard {
  id: string;
  name: string;
  due: string;
  listName: string;
  shortUrl: string;
}

export interface View {
  key: string;
  label: string;
  card: ViewCard | null;
  checklists: ViewChecklist[];
  capturedAt: string;
  ageSeconds: number;
}

function describeCard(snapshot: Snapshot, card: ICard): ViewCard {
  return {
    id: card.id,
    name: (card.name || "").trim(),
    due: card.due || null,
    listName: snapshot.getListNamesById()[card.idList] || null,
    shortUrl: card.shortUrl || null,
  };
}

function buildChecklists(
  snapshot: Snapshot,
  overlay: WriteOverlay,
  cardId: string
): ViewChecklist[] {
  return snapshot
    .getChecklistsForCardId(cardId)
    .map((checklist) => overlay.apply(checklist, snapshot.capturedAt))
    .map((checklist) => ({
      id: checklist.id,
      name: checklist.name,
      cardId,
      total: checklist.checkItems.length,
      complete: checklist.checkItems.filter(
        (item: CheckItem) => item.state === "complete"
      ).length,
      checkItems: checklist.checkItems.map((item: CheckItem) => ({
        id: item.id,
        name: item.name,
        state: item.state,
      })),
    }));
}

export function buildView(
  snapshot: Snapshot,
  overlay: WriteOverlay,
  query: CardQuery
): View {
  const card = findCurrentCard(
    snapshot.getAllCards(),
    query,
    snapshot.getListNamesById()
  );

  const base = {
    key: query.key,
    label: query.label,
    capturedAt: snapshot.capturedAt.toISOString(),
    ageSeconds: snapshot.ageSeconds,
  };

  if (card === undefined) {
    return Object.assign({}, base, { card: null, checklists: [] });
  }

  return Object.assign({}, base, {
    card: describeCard(snapshot, card),
    checklists: buildChecklists(snapshot, overlay, card.id),
  });
}

/**
 * a view for one specific card rather than for a query. Keyed by card id, since these cards come
 *  and go with whatever is in Today today.
 */
function buildCardView(
  snapshot: Snapshot,
  overlay: WriteOverlay,
  card: ICard
): View {
  return {
    key: `today-${card.id}`,
    label: (card.name || "").trim(),
    card: describeCard(snapshot, card),
    checklists: buildChecklists(snapshot, overlay, card.id),
    capturedAt: snapshot.capturedAt.toISOString(),
    ageSeconds: snapshot.ageSeconds,
  };
}

/**
 * every card in Today that carries at least one checklist, minus the cards already shown as
 *  aggregator views (an aggregator card usually lives in Today itself)
 */
export function buildTodayViews(
  snapshot: Snapshot,
  overlay: WriteOverlay,
  excludeCardIds: string[]
): View[] {
  return snapshot
    .getCardsInList(TODAY_LIST_NAME)
    .filter((card) => card !== undefined && card.id !== undefined)
    .filter((card) => excludeCardIds.indexOf(card.id) === -1)
    .filter((card) => snapshot.getChecklistsForCardId(card.id).length > 0)
    .map((card) => buildCardView(snapshot, overlay, card));
}

/** every view in one pass over a single snapshot, Groceries & Errands pinned to the front */
export function buildAllViews(
  snapshot: Snapshot,
  overlay: WriteOverlay
): View[] {
  const aggregators = CARD_QUERIES.map((query) =>
    buildView(snapshot, overlay, query)
  );

  const ordered = aggregators
    .filter((view) => view.key === GROCERIES_QUERY.key)
    .concat(aggregators.filter((view) => view.key !== GROCERIES_QUERY.key));

  const claimed = aggregators
    .filter((view) => view.card !== null)
    .map((view) => view.card.id);

  return ordered.concat(buildTodayViews(snapshot, overlay, claimed));
}
