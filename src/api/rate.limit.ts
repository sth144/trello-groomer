import { logger } from "../lib/logger";

/*************************************************************************************************
 * Fixed-window rate limiting for the unauthenticated /auth/* routes.                              *
 *                                                                                                *
 * These routes are public by necessity — the login has to be reachable before a session exists —  *
 *  and each one makes an outbound OAuth call to Trello (request-token on /auth/trello, access-    *
 *  token on the callback). Left open on a public origin, anyone can loop them and spend the       *
 *  server key's Trello rate limit on our behalf. The cost being protected is Trello quota, not    *
 *  CPU here.                                                                                     *
 *                                                                                                *
 * Two windows, because they stop different things: per-IP stops one host hammering the endpoint,  *
 *  and a global ceiling stops a distributed set of them. The global number only has to be         *
 *  comfortable for a single human logging in, which is what makes it usable as a backstop.        *
 *                                                                                                *
 * State is per-process and in memory. That is sufficient at one replica and degrades sensibly if  *
 *  that ever changes: N replicas means N times the ceiling, not a broken limiter.                 *
 *************************************************************************************************/

export interface RateLimitOptions {
  /** window length in milliseconds */
  windowMs: number;
  /** requests allowed per client address within a window */
  maxPerAddress: number;
  /** requests allowed across all addresses within a window */
  maxTotal: number;
  /** injectable so tests do not have to sleep */
  now?: () => number;
}

export const AUTH_RATE_LIMIT: RateLimitOptions = {
  windowMs: 60 * 1000,
  maxPerAddress: 10,
  maxTotal: 30,
};

interface Window {
  startedAt: number;
  count: number;
}

/**
 * Counts requests per address in fixed windows. `check` reports whether a request is allowed and
 *  counts it if so — a rejected request does not extend the window, so a client that backs off
 *  recovers on schedule instead of being held out by its own retries.
 */
export class RateLimiter {
  private perAddress: Record<string, Window> = {};
  private total: Window = { startedAt: 0, count: 0 };
  private readonly now: () => number;

  constructor(private options: RateLimitOptions) {
    this.now = options.now || Date.now;
    this.total.startedAt = this.now();
  }

  /** @returns seconds to wait when blocked, or undefined when the request may proceed */
  public retryAfter(address: string): number | undefined {
    const now = this.now();

    const total = this.roll(this.total, now);
    const perAddress = this.roll(this.perAddress[address], now);
    this.perAddress[address] = perAddress;

    if (perAddress.count >= this.options.maxPerAddress) {
      return this.secondsLeft(perAddress, now);
    }
    if (total.count >= this.options.maxTotal) {
      return this.secondsLeft(total, now);
    }

    perAddress.count += 1;
    total.count += 1;
    return undefined;
  }

  /** drops per-address windows that have lapsed, so a scan of many addresses cannot grow forever */
  public prune(): void {
    const now = this.now();
    for (const address of Object.keys(this.perAddress)) {
      if (now - this.perAddress[address].startedAt >= this.options.windowMs) {
        delete this.perAddress[address];
      }
    }
  }

  public get trackedAddresses(): number {
    return Object.keys(this.perAddress).length;
  }

  private roll(window: Window | undefined, now: number): Window {
    if (window === undefined || now - window.startedAt >= this.options.windowMs) {
      return { startedAt: now, count: 0 };
    }
    return window;
  }

  private secondsLeft(window: Window, now: number): number {
    const remaining = this.options.windowMs - (now - window.startedAt);
    return Math.max(1, Math.ceil(remaining / 1000));
  }
}

/**
 * express middleware form. `req.ip` is the forwarded client address rather than the proxy's,
 *  because the app sets `trust proxy` — see the note in server.ts.
 */
export function createRateLimitMiddleware(options: RateLimitOptions) {
  const limiter = new RateLimiter(options);
  let sincePrune = 0;

  return (req: any, res: any, next: () => void) => {
    /** amortised cleanup; cheap enough to run inline and avoids holding a timer open */
    if (++sincePrune >= 100) {
      sincePrune = 0;
      limiter.prune();
    }

    const address = req.ip || "unknown";
    const retryAfter = limiter.retryAfter(address);
    if (retryAfter === undefined) {
      next();
      return;
    }

    logger.info(`Rate limited ${req.method} ${req.path} from ${address}`);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "Too many requests. Wait a moment and try again.",
    });
  };
}
