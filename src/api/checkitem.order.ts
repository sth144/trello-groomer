export interface PositionedItem {
  id: string;
  pos: number;
}

/** Find a Trello position between the two items that will surround the moved item. */
export function moveCheckItem(
  items: PositionedItem[],
  itemId: string,
  direction: "up" | "down"
): { pos: number | "top" | "bottom"; ids: string[] } {
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) throw new Error("check item is not in this checklist");
  const target = index + (direction === "up" ? -1 : 1);
  if (target < 0 || target >= items.length) {
    throw new Error("check item is already at the edge");
  }

  const reordered = [...items];
  reordered.splice(index, 1);
  reordered.splice(target, 0, items[index]);
  const before = reordered[target - 1];
  const after = reordered[target + 1];
  const pos = before && after
    ? (before.pos + after.pos) / 2
    : before ? "bottom" : "top";

  if (typeof pos === "number" &&
      (!Number.isFinite(pos) || pos <= before.pos || pos >= after.pos)) {
    throw new Error("Could not find a position for this item. Pull from Trello and retry.");
  }
  return { pos, ids: reordered.map((item) => item.id) };
}
