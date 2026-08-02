import { expect } from "chai";
import { SnapshotUnavailableError } from "./snapshot.store";
import { TrelloRelayError } from "./trello.relay";

/**
 * The API maps these two errors onto HTTP status codes with `instanceof`. Under this project's es5
 *  target, subclassing Error breaks the prototype chain unless the constructor restores it — and
 *  when that happens every error quietly becomes a 500 instead of a 503 / 502 / 400. Guard it.
 */
describe("API error types", () => {
  it("keeps SnapshotUnavailableError identifiable by instanceof", () => {
    const error = new SnapshotUnavailableError("todo");

    expect(error instanceof SnapshotUnavailableError).to.equal(true);
    expect(error instanceof Error).to.equal(true);
    expect(error.message).to.contain("todo");
  });

  it("keeps TrelloRelayError identifiable by instanceof, with its status code", () => {
    const error = new TrelloRelayError("nope", 400);

    expect(error instanceof TrelloRelayError).to.equal(true);
    expect(error instanceof Error).to.equal(true);
    expect(error.statusCode).to.equal(400);
  });

  it("defaults TrelloRelayError to 502, since the failure is upstream", () => {
    expect(new TrelloRelayError("nope").statusCode).to.equal(502);
  });
});
