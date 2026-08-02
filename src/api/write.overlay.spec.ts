import { expect } from "chai";
import { Checklist } from "../lib/checklist.interface";
import { WriteOverlay } from "./write.overlay";

const SNAPSHOT_AT = new Date("2026-08-01T12:00:00.000Z");

function checklist(): Checklist {
  return {
    id: "checklist-1",
    name: "Checklist",
    idCard: "card-1",
    checkItems: [
      { id: "item-1", idChecklist: "checklist-1", name: "Oat milk", state: "incomplete" },
      { id: "item-2", idChecklist: "checklist-1", name: "Bread", state: "complete" },
    ],
  };
}

/** controllable clock so tests can place writes before or after the snapshot */
function overlayAt(nowIso: string): WriteOverlay {
  return new WriteOverlay(() => new Date(nowIso).getTime());
}

describe("WriteOverlay", () => {
  it("leaves a checklist untouched when nothing is pending", () => {
    const overlay = overlayAt("2026-08-01T12:05:00.000Z");

    const result = overlay.apply(checklist(), SNAPSHOT_AT);

    expect(result.checkItems.map((x) => x.state)).to.deep.equal([
      "incomplete",
      "complete",
    ]);
  });

  it("applies a state change made after the snapshot was captured", () => {
    const overlay = overlayAt("2026-08-01T12:05:00.000Z");
    overlay.recordStateChange("item-1", "complete");

    const result = overlay.apply(checklist(), SNAPSHOT_AT);

    expect(result.checkItems[0].state).to.equal("complete");
    /** the untouched item is passed through */
    expect(result.checkItems[1].state).to.equal("complete");
  });

  it("ignores a state change the snapshot already absorbed", () => {
    const overlay = overlayAt("2026-08-01T11:55:00.000Z");
    overlay.recordStateChange("item-2", "incomplete");

    const result = overlay.apply(checklist(), SNAPSHOT_AT);

    /** snapshot is newer, so Trello's version wins */
    expect(result.checkItems[1].state).to.equal("complete");
  });

  it("hides an item deleted after the snapshot", () => {
    const overlay = overlayAt("2026-08-01T12:05:00.000Z");
    overlay.recordRemove("item-2");

    const result = overlay.apply(checklist(), SNAPSHOT_AT);

    expect(result.checkItems.map((x) => x.id)).to.deep.equal(["item-1"]);
  });

  it("adds an item created after the snapshot", () => {
    const overlay = overlayAt("2026-08-01T12:05:00.000Z");
    overlay.recordAdd("checklist-1", {
      id: "item-3",
      idChecklist: "checklist-1",
      name: "Coffee",
      state: "incomplete",
    });

    const result = overlay.apply(checklist(), SNAPSHOT_AT);

    expect(result.checkItems.map((x) => x.id)).to.deep.equal([
      "item-1",
      "item-2",
      "item-3",
    ]);
  });

  it("does not double up an added item once the snapshot includes it", () => {
    const overlay = overlayAt("2026-08-01T12:05:00.000Z");
    overlay.recordAdd("checklist-1", {
      id: "item-2",
      idChecklist: "checklist-1",
      name: "Bread",
      state: "complete",
    });

    const result = overlay.apply(checklist(), SNAPSHOT_AT);

    expect(result.checkItems.filter((x) => x.id === "item-2").length).to.equal(1);
  });

  it("applies a state change to an item that only exists as a pending add", () => {
    const overlay = overlayAt("2026-08-01T12:05:00.000Z");
    overlay.recordAdd("checklist-1", {
      id: "item-3",
      idChecklist: "checklist-1",
      name: "Coffee",
      state: "incomplete",
    });
    overlay.recordStateChange("item-3", "complete");

    const result = overlay.apply(checklist(), SNAPSHOT_AT);

    const added = result.checkItems.filter((x) => x.id === "item-3")[0];
    expect(added.state).to.equal("complete");
  });

  it("drops a pending add when the item is deleted again", () => {
    const overlay = overlayAt("2026-08-01T12:05:00.000Z");
    overlay.recordAdd("checklist-1", {
      id: "item-3",
      idChecklist: "checklist-1",
      name: "Coffee",
      state: "incomplete",
    });
    overlay.recordRemove("item-3");

    const result = overlay.apply(checklist(), SNAPSHOT_AT);

    expect(result.checkItems.map((x) => x.id)).to.deep.equal([
      "item-1",
      "item-2",
    ]);
  });

  it("does not mutate the snapshot's own checklist", () => {
    const overlay = overlayAt("2026-08-01T12:05:00.000Z");
    overlay.recordStateChange("item-1", "complete");
    const original = checklist();

    overlay.apply(original, SNAPSHOT_AT);

    expect(original.checkItems[0].state).to.equal("incomplete");
  });

  it("prunes entries a newer snapshot has absorbed", () => {
    const overlay = overlayAt("2026-08-01T11:55:00.000Z");
    overlay.recordStateChange("item-1", "complete");
    overlay.recordRemove("item-2");
    overlay.recordAdd("checklist-1", {
      id: "item-3",
      idChecklist: "checklist-1",
      name: "Coffee",
      state: "incomplete",
    });
    expect(overlay.size).to.be.greaterThan(0);

    overlay.prune(SNAPSHOT_AT);

    expect(overlay.size).to.equal(0);
  });

  it("keeps entries newer than the snapshot when pruning", () => {
    const overlay = overlayAt("2026-08-01T12:05:00.000Z");
    overlay.recordStateChange("item-1", "complete");

    overlay.prune(SNAPSHOT_AT);

    expect(overlay.size).to.equal(1);
  });
});
