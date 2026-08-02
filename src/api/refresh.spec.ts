import { expect } from "chai";
import { join } from "path";
import { BoardRefreshError, BoardRefresher } from "./refresh";
import { SnapshotStore } from "./snapshot.store";

describe("BoardRefresher", () => {
  const refresher = () =>
    new BoardRefresher(new SnapshotStore(join(process.cwd(), "cache")), {
      key: "k",
      token: "t",
    });

  it("supports the boards whose models are cheap to load", () => {
    expect(refresher().getSupportedBoards()).to.deep.equal(["todo", "work"]);
  });

  it("rejects a board it has no model for, without calling Trello", async () => {
    let caught: unknown;

    try {
      await refresher().refresh("media");
    } catch (e) {
      caught = e;
    }

    expect(caught instanceof BoardRefreshError).to.equal(true);
    expect((caught as BoardRefreshError).statusCode).to.equal(400);
    expect((caught as BoardRefreshError).message).to.contain("todo, work");
  });

  it("rejects an unknown board name", async () => {
    let caught: unknown;

    try {
      await refresher().refresh("../etc/passwd");
    } catch (e) {
      caught = e;
    }

    expect(caught instanceof BoardRefreshError).to.equal(true);
    expect((caught as BoardRefreshError).statusCode).to.equal(400);
  });

  it("keeps BoardRefreshError identifiable through es5 downlevelling", () => {
    const error = new BoardRefreshError("nope");

    expect(error instanceof BoardRefreshError).to.equal(true);
    expect(error instanceof Error).to.equal(true);
    expect(error.statusCode).to.equal(502);
  });
});
