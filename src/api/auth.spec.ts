import { expect } from "chai";
import {
  AuthConfigError,
  CALLBACK_PATH,
  MemberAllowlist,
  isPublicPath,
  loadAuthConfig,
  wantsHtml,
} from "./auth";
import { join } from "path";

describe("auth", () => {
  describe("isPublicPath", () => {
    it("leaves /api/health open, since the kubernetes probes depend on it", () => {
      expect(isPublicPath("/api/health")).to.equal(true);
    });

    it("leaves the login flow reachable", () => {
      expect(isPublicPath("/auth/trello")).to.equal(true);
      expect(isPublicPath(CALLBACK_PATH)).to.equal(true);
      expect(isPublicPath("/auth/logout")).to.equal(true);
    });

    it("gates the rest of the API", () => {
      for (const path of [
        "/api/views",
        "/api/views/groceries",
        "/api/boards/todo/cards",
        "/api/boards/todo/stats",
        "/api/cards/abc/checkItem/def",
        "/api/checklists/abc/checkItems",
        "/api/refresh/todo",
        "/api/docs",
        "/api/openapi.json",
      ]) {
        expect(isPublicPath(path), `${path} must require a session`).to.equal(
          false
        );
      }
    });

    it("gates the client itself", () => {
      expect(isPublicPath("/")).to.equal(false);
      expect(isPublicPath("/index.html")).to.equal(false);
    });

    it("is not fooled by a path that merely contains a public prefix", () => {
      expect(isPublicPath("/api/boards/todo/cards?next=/auth/")).to.equal(false);
      expect(isPublicPath("/api/health/../views")).to.equal(false);
    });
  });

  describe("CALLBACK_PATH", () => {
    /**
     * The single deployment has to serve both http://<lan-ip>:30450 and https://<public-host>.
     * passport-oauth1 only resolves the callback against the incoming request when the configured
     * value is relative — hardcode an absolute URL here and logins from the other origin break.
     */
    it("stays relative, so the callback follows whichever origin was used", () => {
      expect(CALLBACK_PATH.indexOf("/")).to.equal(0);
      expect(CALLBACK_PATH).to.not.contain("://");
    });

    it("resolves per origin the way passport-oauth1 will resolve it", () => {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const url = require("url");
      const utils = require("passport-oauth1/lib/utils");
      const trustingApp = { get: (key: string) => key === "trust proxy" };

      const lan = {
        app: trustingApp,
        url: "/auth/trello",
        connection: {},
        headers: { host: "192.168.1.242:30450" },
      };
      const proxied = {
        app: trustingApp,
        url: "/auth/trello",
        connection: {},
        headers: {
          host: "trello-groomer-api.default.svc",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "trello.example.org",
        },
      };

      const resolve = (req: unknown) =>
        url.resolve(utils.originalURL(req, { proxy: true }), CALLBACK_PATH);

      expect(resolve(lan)).to.equal(
        "http://192.168.1.242:30450/auth/trello/callback"
      );
      expect(resolve(proxied)).to.equal(
        "https://trello.example.org/auth/trello/callback"
      );
    });
  });

  describe("wantsHtml", () => {
    it("redirects a browser navigation but 401s an XHR", () => {
      expect(
        wantsHtml({
          headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
        })
      ).to.equal(true);
      expect(wantsHtml({ headers: { accept: "application/json" } })).to.equal(
        false
      );
      expect(wantsHtml({ headers: {} })).to.equal(false);
    });
  });

  describe("loadAuthConfig", () => {
    const emptyDir = join(process.cwd(), "src", "api");

    afterEach(() => {
      delete process.env.TRELLO_CONSUMER_SECRET;
      delete process.env.SESSION_SECRET;
    });

    it("refuses to start when the secrets are absent", () => {
      let caught: unknown;
      try {
        loadAuthConfig(emptyDir);
      } catch (e) {
        caught = e;
      }

      expect(caught instanceof AuthConfigError).to.equal(true);
      expect((caught as Error).message).to.contain("consumerSecret");
      expect((caught as Error).message).to.contain("sessionSecret");
    });

    it("names only the missing secret", () => {
      process.env.TRELLO_CONSUMER_SECRET = "secret";
      let caught: unknown;
      try {
        loadAuthConfig(emptyDir);
      } catch (e) {
        caught = e;
      }

      const message = (caught as Error).message;
      expect(message).to.contain("sessionSecret");
      expect(message).to.not.contain("consumerSecret and");
    });

    it("accepts secrets from the environment, for kubernetes Secrets", () => {
      process.env.TRELLO_CONSUMER_SECRET = "from-env";
      process.env.SESSION_SECRET = "also-from-env";

      const config = loadAuthConfig(emptyDir);

      expect(config.consumerSecret).to.equal("from-env");
      expect(config.sessionSecret).to.equal("also-from-env");
      /** a Secure cookie would never reach a LAN client over plain http */
      expect(config.secureCookie).to.equal(false);
    });
  });

  describe("MemberAllowlist", () => {
    it("uses configured ids without calling Trello", async () => {
      const allowlist = new MemberAllowlist(["member-1", "member-2"], {
        key: "unused",
        token: "unused",
      });

      expect(await allowlist.getAllowedIds()).to.deep.equal([
        "member-1",
        "member-2",
      ]);
    });

    it("treats an empty configured list as unset rather than as deny-all", async () => {
      const allowlist = new MemberAllowlist([], { key: "k", token: "t" });
      /** would otherwise lock everyone out silently; force the Trello lookup path instead */
      let looked = false;
      (allowlist as any).lookupTokenOwner = async () => {
        looked = true;
        return ["owner"];
      };

      expect(await allowlist.getAllowedIds()).to.deep.equal(["owner"]);
      expect(looked).to.equal(true);
    });

    it("resolves the token owner once and caches it", async () => {
      const allowlist = new MemberAllowlist(undefined, { key: "k", token: "t" });
      let calls = 0;
      (allowlist as any).lookupTokenOwner = async () => {
        calls += 1;
        return ["owner-id"];
      };

      expect(await allowlist.getAllowedIds()).to.deep.equal(["owner-id"]);
      expect(await allowlist.getAllowedIds()).to.deep.equal(["owner-id"]);
      expect(calls).to.equal(1);
    });

    it("coalesces concurrent lookups", async () => {
      const allowlist = new MemberAllowlist(undefined, { key: "k", token: "t" });
      let calls = 0;
      (allowlist as any).lookupTokenOwner = async () => {
        calls += 1;
        return ["owner-id"];
      };

      const [a, b] = await Promise.all([
        allowlist.getAllowedIds(),
        allowlist.getAllowedIds(),
      ]);

      expect(a).to.deep.equal(["owner-id"]);
      expect(b).to.deep.equal(["owner-id"]);
      expect(calls).to.equal(1);
    });

    it("does not cache a failed lookup", async () => {
      const allowlist = new MemberAllowlist(undefined, { key: "k", token: "t" });
      let calls = 0;
      (allowlist as any).lookupTokenOwner = async () => {
        calls += 1;
        if (calls === 1) throw new Error("Trello unreachable");
        return ["owner-id"];
      };

      let firstFailed = false;
      try {
        await allowlist.getAllowedIds();
      } catch (e) {
        firstFailed = true;
      }

      expect(firstFailed).to.equal(true);
      expect(await allowlist.getAllowedIds()).to.deep.equal(["owner-id"]);
    });
  });
});
