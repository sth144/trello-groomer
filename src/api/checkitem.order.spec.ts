import { expect } from "chai";
import { moveCheckItem } from "./checkitem.order";

describe("moveCheckItem", () => {
  const items = [
    { id: "a", pos: 1000 },
    { id: "b", pos: 2000 },
    { id: "c", pos: 3000 },
  ];

  it("moves an item between its new neighbors", () => {
    expect(moveCheckItem(items, "a", "down")).to.deep.equal({
      pos: 2500,
      ids: ["b", "a", "c"],
    });
    expect(items.map((item) => item.id)).to.deep.equal(["a", "b", "c"]);
  });

  it("uses Trello's edge positions at the top and bottom", () => {
    expect(moveCheckItem(items, "b", "up")).to.deep.equal({
      pos: "top",
      ids: ["b", "a", "c"],
    });
    expect(moveCheckItem(items, "b", "down")).to.deep.equal({
      pos: "bottom",
      ids: ["a", "c", "b"],
    });
  });

  it("rejects an item that cannot move in the requested direction", () => {
    expect(() => moveCheckItem(items, "a", "up")).to.throw("already at the edge");
  });
});
