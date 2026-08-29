import { expect } from "chai";
import { RateLimiter } from "./rate.limit";

/**
 * The limiter exists to stop an open /auth/* route spending the server key's Trello quota, so the
 *  cases that matter are the ones where it would otherwise leak requests through: a window that
 *  never rolls, a blocked client that keeps its own window alive by retrying, and one address
 *  eating the whole global allowance.
 */
describe("RateLimiter", () => {
  /** clock the tests drive by hand, so nothing has to sleep */
  const at = (start: number) => {
    let clock = start;
    return {
      now: () => clock,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  };

  const options = (now: () => number) => ({
    windowMs: 1000,
    maxPerAddress: 3,
    maxTotal: 5,
    now,
  });

  it("allows up to the per-address limit, then reports a wait", () => {
    const clock = at(0);
    const limiter = new RateLimiter(options(clock.now));

    expect(limiter.retryAfter("a")).to.equal(undefined);
    expect(limiter.retryAfter("a")).to.equal(undefined);
    expect(limiter.retryAfter("a")).to.equal(undefined);
    expect(limiter.retryAfter("a")).to.be.a("number");
  });

  it("counts addresses separately", () => {
    const clock = at(0);
    const limiter = new RateLimiter(options(clock.now));

    limiter.retryAfter("a");
    limiter.retryAfter("a");
    limiter.retryAfter("a");

    expect(limiter.retryAfter("a")).to.be.a("number");
    expect(limiter.retryAfter("b")).to.equal(undefined);
  });

  it("lets a blocked address back in once its window rolls", () => {
    const clock = at(0);
    const limiter = new RateLimiter(options(clock.now));

    limiter.retryAfter("a");
    limiter.retryAfter("a");
    limiter.retryAfter("a");
    expect(limiter.retryAfter("a")).to.be.a("number");

    clock.advance(1000);
    expect(limiter.retryAfter("a")).to.equal(undefined);
  });

  /** a rejected request must not count, or a client that keeps retrying never gets back in */
  it("does not let a blocked client extend its own window by retrying", () => {
    const clock = at(0);
    const limiter = new RateLimiter(options(clock.now));

    limiter.retryAfter("a");
    limiter.retryAfter("a");
    limiter.retryAfter("a");

    clock.advance(900);
    expect(limiter.retryAfter("a")).to.be.a("number");

    clock.advance(100);
    expect(limiter.retryAfter("a")).to.equal(undefined);
  });

  /** the point of the global ceiling: many addresses, each under its own limit */
  it("applies a global ceiling across distinct addresses", () => {
    const clock = at(0);
    const limiter = new RateLimiter(options(clock.now));

    expect(limiter.retryAfter("a")).to.equal(undefined);
    expect(limiter.retryAfter("b")).to.equal(undefined);
    expect(limiter.retryAfter("c")).to.equal(undefined);
    expect(limiter.retryAfter("d")).to.equal(undefined);
    expect(limiter.retryAfter("e")).to.equal(undefined);

    expect(limiter.retryAfter("f")).to.be.a("number");
  });

  it("reports whole seconds of wait, never zero", () => {
    const clock = at(0);
    const limiter = new RateLimiter(options(clock.now));

    limiter.retryAfter("a");
    limiter.retryAfter("a");
    limiter.retryAfter("a");

    clock.advance(999);
    expect(limiter.retryAfter("a")).to.equal(1);
  });

  it("forgets lapsed addresses so a scan cannot grow the map forever", () => {
    const clock = at(0);
    const limiter = new RateLimiter(options(clock.now));

    limiter.retryAfter("a");
    limiter.retryAfter("b");
    expect(limiter.trackedAddresses).to.equal(2);

    clock.advance(1000);
    limiter.prune();
    expect(limiter.trackedAddresses).to.equal(0);
  });

  it("keeps addresses whose window is still open", () => {
    const clock = at(0);
    const limiter = new RateLimiter(options(clock.now));

    limiter.retryAfter("a");
    clock.advance(500);
    limiter.prune();

    expect(limiter.trackedAddresses).to.equal(1);
  });
});
