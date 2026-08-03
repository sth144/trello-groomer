import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { logger } from "../lib/logger";
import { TrelloHttpClient } from "../lib/http.client";

/*************************************************************************************************
 * Trello OAuth 1.0a login, gating the client and the whole API.                                  *
 *                                                                                               *
 * Trello is used as the identity provider rather than Google for two reasons: it is the tie the   *
 *  board owner actually wants (logging in *is* logging into Trello), and its OAuth accepts a      *
 *  return URL at request time instead of pre-registering one — so a single deployment serves      *
 *  http://<lan-ip>:30450 and https://<host> without extra configuration.                          *
 *                                                                                               *
 * That last part relies on passport-oauth1 resolving a relative callbackURL against the incoming  *
 *  request, honouring X-Forwarded-Proto / X-Forwarded-Host when `trust proxy` is set. Keep the     *
 *  callback relative and `trust proxy` on, or remote HTTPS logins will be handed an http:// URL.   *
 *************************************************************************************************/

/* eslint-disable @typescript-eslint/no-var-requires */
const passport = require("passport");
const TrelloStrategy = require("passport-trello").Strategy;
const cookieSession = require("cookie-session");

export const CALLBACK_PATH = "/auth/trello/callback";

/** paths reachable without a session. Everything else is gated. */
export const PUBLIC_PATH_PREFIXES = ["/auth/"];
export const PUBLIC_PATHS = [
  /** the kubernetes readiness and liveness probes hit this — gating it restart-loops the pod */
  "/api/health",
];

export interface AuthConfig {
  /** Trello API key; defaults to the one in config/key.json */
  consumerKey?: string;
  /** Trello API secret from https://trello.com/app-key — NOT the server token */
  consumerSecret: string;
  /** signing key for the session cookie */
  sessionSecret: string;
  /**
   * Trello member ids allowed in. Left unset, the board owner is resolved from the server token,
   *  which keeps the allowlist tied to Trello rather than hardcoded here.
   */
  allowedMemberIds?: string[];
  /** optional shared key for non-browser clients (cron, scripts), sent as X-API-Key or Bearer */
  apiKey?: string;
  /**
   * mark the session cookie Secure. Must stay false while the LAN is served over plain HTTP, since
   *  a Secure cookie would never be sent there.
   */
  secureCookie?: boolean;
  appName?: string;
}

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    /** es5 downlevelling breaks `instanceof` on Error subclasses — see snapshot.store.ts */
    Object.setPrototypeOf(this, AuthConfigError.prototype);
  }
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
}

/**
 * loads auth config from config/oauth.json, with env vars taking precedence so the secrets can come
 *  from a kubernetes Secret instead of the config volume
 */
export function loadAuthConfig(configDir: string): AuthConfig {
  const path = join(configDir, "oauth.json");
  let fromFile: Partial<AuthConfig> = {};

  if (existsSync(path)) {
    fromFile = JSON.parse(readFileSync(path, "utf8"));
  }

  const config: AuthConfig = {
    consumerKey: process.env.TRELLO_CONSUMER_KEY || fromFile.consumerKey,
    consumerSecret:
      process.env.TRELLO_CONSUMER_SECRET || fromFile.consumerSecret,
    sessionSecret: process.env.SESSION_SECRET || fromFile.sessionSecret,
    allowedMemberIds: fromFile.allowedMemberIds,
    apiKey: process.env.API_KEY || fromFile.apiKey,
    secureCookie: fromFile.secureCookie === true,
    appName: fromFile.appName || "Trello Groomer",
  };

  const missing: string[] = [];
  if (!config.consumerSecret) missing.push("consumerSecret");
  if (!config.sessionSecret) missing.push("sessionSecret");

  if (missing.length > 0) {
    throw new AuthConfigError(
      `Cannot start: auth is enabled but ${missing.join(" and ")} ` +
        `${missing.length === 1 ? "is" : "are"} missing. Create ${path} from ` +
        `config/templates/oauth.template.json (consumerSecret comes from ` +
        `https://trello.com/app-key, and is not the server token), or supply ` +
        `TRELLO_CONSUMER_SECRET and SESSION_SECRET in the environment.`
    );
  }

  return config;
}

/**
 * resolves which Trello member ids may sign in. Configured ids win; otherwise the owner of the
 *  server token is looked up once and cached, so access follows the Trello token rather than a
 *  value copied into config.
 */
export class MemberAllowlist {
  private resolved: string[] | undefined;
  private inFlight: Promise<string[]> | undefined;

  constructor(
    private configured: string[] | undefined,
    private secrets: { key: string; token: string }
  ) {}

  public async getAllowedIds(): Promise<string[]> {
    if (this.configured !== undefined && this.configured.length > 0) {
      return this.configured;
    }
    if (this.resolved !== undefined) {
      return this.resolved;
    }
    if (this.inFlight !== undefined) {
      return this.inFlight;
    }

    this.inFlight = this.lookupTokenOwner();
    try {
      this.resolved = await this.inFlight;
      return this.resolved;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async lookupTokenOwner(): Promise<string[]> {
    const client = new TrelloHttpClient(this.secrets);
    const response = await client.asyncGet("/members/me?fields=id,username");

    const member =
      typeof response === "string" ? JSON.parse(response) : response;
    if (!member || !member.id) {
      throw new Error("Trello did not return a member id for the server token");
    }

    logger.info(
      `Auth allowlist resolved from the server token: member ${member.id}`
    );
    return [member.id];
  }
}

export function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.indexOf(path) !== -1) {
    return true;
  }
  return PUBLIC_PATH_PREFIXES.some((prefix) => path.indexOf(prefix) === 0);
}

/** a browser navigating to a page gets redirected; anything else gets a 401 it can act on */
export function wantsHtml(req: {
  headers: Record<string, string | undefined>;
}): boolean {
  const accept = (req.headers["accept"] || "").toLowerCase();
  return accept.indexOf("text/html") !== -1;
}

export interface AuthHandles {
  /** middleware to mount before any route, in order */
  middleware: unknown[];
  /** gate to mount after the auth routes */
  requireAuth: (req: any, res: any, next: () => void) => void;
  /** registers /auth/* routes on the app */
  mountRoutes: (app: any) => void;
}

export function createAuth(
  config: AuthConfig,
  secrets: { key: string; token: string }
): AuthHandles {
  const allowlist = new MemberAllowlist(config.allowedMemberIds, secrets);

  passport.use(
    new TrelloStrategy(
      {
        consumerKey: config.consumerKey || secrets.key,
        consumerSecret: config.consumerSecret,
        /** relative on purpose — see the note at the top of this file */
        callbackURL: CALLBACK_PATH,
        trelloParams: {
          name: config.appName,
          /**
           * login is only ever used to establish identity; board access still goes through the
           *  server token, so this asks for the least Trello will grant and lets it lapse.
           */
          scope: ["read"],
          expiration: "1hour",
        },
      },
      async (
        _token: string,
        _tokenSecret: string,
        profile: any,
        done: (err: Error | null, user?: SessionUser | false) => void
      ) => {
        try {
          /**
           * passport-trello references InternalOAuthError without importing it, so a failed profile
           *  fetch throws a ReferenceError rather than surfacing cleanly. Treat a profile without
           *  an id as a failed login instead of trusting it.
           */
          if (!profile || !profile.id) {
            logger.error("Trello login returned no profile id");
            done(null, false);
            return;
          }

          const allowed = await allowlist.getAllowedIds();
          if (allowed.indexOf(profile.id) === -1) {
            logger.info(`Refused Trello login for member ${profile.id}`);
            done(null, false);
            return;
          }

          const json = profile._json || {};
          done(null, {
            id: profile.id,
            username: json.username || "",
            displayName: profile.displayName || json.username || "",
          });
        } catch (e) {
          logger.error(`Trello login failed: ${e}`);
          done(e as Error);
        }
      }
    )
  );

  const session = cookieSession({
    name: "tg.sid",
    keys: [config.sessionSecret],
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookie === true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  const requireAuth = (req: any, res: any, next: () => void) => {
    if (isPublicPath(req.path)) {
      next();
      return;
    }

    if (req.session && req.session.user) {
      next();
      return;
    }

    if (config.apiKey && presentedApiKey(req) === config.apiKey) {
      next();
      return;
    }

    if (wantsHtml(req)) {
      /** come back to whatever was being asked for once the login completes */
      if (req.session) {
        req.session.returnTo = req.originalUrl;
      }
      res.redirect("/auth/trello");
      return;
    }

    res.status(401).json({
      error: "Not signed in. Visit /auth/trello, or send X-API-Key.",
    });
  };

  const mountRoutes = (app: any) => {
    app.get(
      "/auth/trello",
      passport.authenticate("trello", { session: false })
    );

    app.get(
      CALLBACK_PATH,
      /**
       * session:false keeps passport out of session serialisation entirely. passport 0.6+ expects
       *  session.regenerate/save, which cookie-session does not implement, and identity is all
       *  that is needed here — so the user is written to the session directly below.
       */
      passport.authenticate("trello", {
        session: false,
        failureRedirect: "/auth/failed",
      }),
      (req: any, res: any) => {
        req.session.user = req.user;
        const target = req.session.returnTo || "/";
        delete req.session.returnTo;
        logger.info(`Trello login succeeded for member ${req.user.id}`);
        res.redirect(target);
      }
    );

    app.get("/auth/failed", (_req: any, res: any) => {
      res
        .status(403)
        .type("html")
        .send(
          "<h1>Not authorised</h1><p>That Trello account cannot use this board. " +
            '<a href="/auth/trello">Try again</a></p>'
        );
    });

    app.get("/auth/logout", (req: any, res: any) => {
      req.session = null;
      res.redirect("/auth/signed-out");
    });

    app.get("/auth/signed-out", (_req: any, res: any) => {
      res
        .status(200)
        .type("html")
        .send('<h1>Signed out</h1><p><a href="/">Sign back in</a></p>');
    });
  };

  return { middleware: [session, passport.initialize()], requireAuth, mountRoutes };
}

function presentedApiKey(req: any): string | undefined {
  const header = req.headers["x-api-key"];
  if (typeof header === "string" && header.length > 0) {
    return header;
  }
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.toLowerCase().indexOf("bearer ") === 0) {
    return auth.slice(7).trim();
  }
  return undefined;
}
