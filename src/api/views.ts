import { Snapshot } from "./snapshot.store";
import { WriteOverlay } from "./write.overlay";
import { CheckItem } from "../lib/checklist.interface";
import { CardQuery, CARD_QUERIES, findCurrentCard } from "../lib/card.queries";

/*************************************************************************************************
 * "Views" are the resolved aggregator cards (Sprint, Groceries & Errands, Research Tasks) with    *
 *  their checklists, which is what a client actually wants — as opposed to a raw board dump.      *
 *************************************************************************************************/

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

export interface View {
  key: string;
  label: string;
  card: {
    id: string;
    name: string;
    due: string;
    listName: string;
    shortUrl: string;
  } | null;
  checklists: ViewChecklist[];
  capturedAt: string;
  ageSeconds: number;
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

  const checklists: ViewChecklist[] = snapshot
    .getChecklistsForCardId(card.id)
    .map((checklist) => overlay.apply(checklist, snapshot.capturedAt))
    .map((checklist) => ({
      id: checklist.id,
      name: checklist.name,
      cardId: card.id,
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

  return Object.assign({}, base, {
    card: {
      id: card.id,
      name: (card.name || "").trim(),
      due: card.due || null,
      listName: snapshot.getListNamesById()[card.idList] || null,
      shortUrl: card.shortUrl || null,
    },
    checklists,
  });
}

/** every view in one pass over a single snapshot */
export function buildAllViews(
  snapshot: Snapshot,
  overlay: WriteOverlay
): View[] {
  return CARD_QUERIES.map((query) => buildView(snapshot, overlay, query));
}
