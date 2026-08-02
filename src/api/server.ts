import { existsSync } from "fs";
import { join } from "path";
import { logger } from "../lib/logger";
import { SnapshotStore, SnapshotUnavailableError } from "./snapshot.store";
import { WriteOverlay } from "./write.overlay";
import { TrelloRelay, TrelloRelayError } from "./trello.relay";
import { buildAllViews, buildView } from "./views";
import { getCardQueryByKey } from "../lib/card.queries";
import { openApiDocument } from "./openapi";
import { BoardRefreshError, BoardRefresher } from "./refresh";

/*************************************************************************************************
 * Express app exposing the groomer's cached board state, plus write-through endpoints for check    *
 *  items. express and swagger-ui-express are required rather than imported, matching how the rest  *
 *  of this codebase consumes untyped deps (see lib/http.client.ts).                               *
 *************************************************************************************************/

/* eslint-disable @typescript-eslint/no-var-requires */
const express = require("express");
const swaggerUi = require("swagger-ui-express");

/** minimal surface of the express req/res objects actually used here */
interface ApiRequest {
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, string>;
  method: string;
  path: string;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  set(field: string, value: string): ApiResponse;
  sendStatus(code: number): void;
}

export interface ApiServerOptions {
  cacheDir?: string;
  clientDir?: string;
  secrets: { key: string; token: string };
  /** the board whose snapshot backs /api/views */
  viewsBoard?: string;
}

const DEFAULT_CARD_LIMIT = 200;
const MAX_CARD_LIMIT = 2000;

export function createApiServer(options: ApiServerOptions) {
  const cacheDir = options.cacheDir || join(process.cwd(), "cache");
  const clientDir = options.clientDir || join(process.cwd(), "client/dist/client/browser");
  const viewsBoard = options.viewsBoard || "todo";

  const store = new SnapshotStore(cacheDir);
  const overlay = new WriteOverlay();
  const relay = new TrelloRelay(options.secrets, overlay);
  const refresher = new BoardRefresher(store, options.secrets);
  const startedAt = Date.now();

  const app = express();
  app.use(express.json());

  /** the client may be served from `ng serve` during development */
  app.use((req: ApiRequest, res: ApiResponse, next: () => void) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  /**
   * resolves a snapshot, answering 503 rather than 500 when a groomer has simply not run yet.
   * Returns undefined once it has already written a response.
   */
  const readSnapshot = (board: string, res: ApiResponse) => {
    try {
      const snapshot = store.getSnapshot(board);
      /** keep the overlay from accumulating writes the snapshot now covers */
      overlay.prune(snapshot.capturedAt);
      return snapshot;
    } catch (e) {
      if (e instanceof SnapshotUnavailableError) {
        res.status(503).json({ error: e.message });
        return undefined;
      }
      logger.error(`Failed to read snapshot for ${board}: ${e}`);
      res.status(500).json({ error: `Could not read snapshot for ${board}` });
      return undefined;
    }
  };

  const handleWriteError = (e: unknown, res: ApiResponse) => {
    if (e instanceof BoardRefreshError) {
      logger.error(`Refresh error: ${e.message}`);
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    if (e instanceof TrelloRelayError) {
      logger.error(`Relay error: ${e.message}`);
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    logger.error(`Unexpected write failure: ${e}`);
    res.status(500).json({ error: "Unexpected failure relaying to Trello" });
  };

  /*********************************** meta / docs ***********************************/

  app.get("/api/health", (_req: ApiRequest, res: ApiResponse) => {
    res.json({
      status: "ok",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      trelloRequests: relay.numRequests,
      overlayEntries: overlay.size,
      boards: store.getAvailableBoards(),
    });
  });

  app.get("/api/openapi.json", (_req: ApiRequest, res: ApiResponse) => {
    res.json(openApiDocument);
  });

  app.use(
    "/api/docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: "Trello Groomer API",
      swaggerOptions: { displayRequestDuration: true },
    })
  );

  /************************************** views **************************************/

  app.get("/api/views", (_req: ApiRequest, res: ApiResponse) => {
    const snapshot = readSnapshot(viewsBoard, res);
    if (snapshot === undefined) return;
    res.json(buildAllViews(snapshot, overlay));
  });

  app.get("/api/views/:key", (req: ApiRequest, res: ApiResponse) => {
    const query = getCardQueryByKey(req.params.key);
    if (query === undefined) {
      res.status(404).json({ error: `Unknown view "${req.params.key}"` });
      return;
    }
    const snapshot = readSnapshot(viewsBoard, res);
    if (snapshot === undefined) return;
    res.json(buildView(snapshot, overlay, query));
  });

  /************************************** boards *************************************/

  app.get("/api/boards", (_req: ApiRequest, res: ApiResponse) => {
    res.json(store.getAvailableBoards());
  });

  app.get("/api/boards/:board/lists", (req: ApiRequest, res: ApiResponse) => {
    const snapshot = readSnapshot(req.params.board, res);
    if (snapshot === undefined) return;
    res.json({
      capturedAt: snapshot.capturedAt.toISOString(),
      ageSeconds: snapshot.ageSeconds,
      lists: snapshot.getLists(),
    });
  });

  app.get("/api/boards/:board/cards", (req: ApiRequest, res: ApiResponse) => {
    const snapshot = readSnapshot(req.params.board, res);
    if (snapshot === undefined) return;

    const requestedLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(
      isNaN(requestedLimit) || requestedLimit < 1
        ? DEFAULT_CARD_LIMIT
        : requestedLimit,
      MAX_CARD_LIMIT
    );

    let cards = req.query.list
      ? snapshot.getCardsInList(req.query.list)
      : snapshot.getAllCards();

    if (req.query.q) {
      const needle = req.query.q.toLowerCase();
      cards = cards.filter(
        (card) => card.name && card.name.toLowerCase().indexOf(needle) !== -1
      );
    }

    const listNames = snapshot.getListNamesById();
    res.json({
      capturedAt: snapshot.capturedAt.toISOString(),
      ageSeconds: snapshot.ageSeconds,
      total: cards.length,
      limit,
      cards: cards.slice(0, limit).map((card) => ({
        id: card.id,
        name: card.name,
        due: card.due || null,
        dueComplete: card.dueComplete === true,
        listName: listNames[card.idList] || null,
        idList: card.idList,
        idLabels: card.idLabels || [],
        shortUrl: card.shortUrl || null,
      })),
    });
  });

  app.get(
    "/api/boards/:board/cards/:cardId",
    (req: ApiRequest, res: ApiResponse) => {
      const snapshot = readSnapshot(req.params.board, res);
      if (snapshot === undefined) return;

      const card = snapshot.getCardById(req.params.cardId);
      if (card === undefined) {
        res.status(404).json({
          error: `Card ${req.params.cardId} is not in the ${req.params.board} snapshot`,
        });
        return;
      }

      res.json({
        capturedAt: snapshot.capturedAt.toISOString(),
        ageSeconds: snapshot.ageSeconds,
        card: {
          id: card.id,
          name: card.name,
          desc: card.desc,
          due: card.due || null,
          dueComplete: card.dueComplete === true,
          listName: snapshot.getListNamesById()[card.idList] || null,
          idLabels: card.idLabels || [],
          shortUrl: card.shortUrl || null,
          attachments: card.attachments || [],
        },
        checklists: snapshot
          .getChecklistsForCardId(card.id)
          .map((checklist) => overlay.apply(checklist, snapshot.capturedAt)),
      });
    }
  );

  app.get("/api/boards/:board/stats", (req: ApiRequest, res: ApiResponse) => {
    const snapshot = readSnapshot(req.params.board, res);
    if (snapshot === undefined) return;
    res.json(snapshot.getStats());
  });

  /************************************* refresh *************************************/

  /**
   * rebuild a board from Trello now, rather than waiting for the next groomer run. Costs ~12
   *  sequential Trello requests, so it is deliberately a POST and never happens on a read.
   */
  app.post("/api/refresh/:board", async (req: ApiRequest, res: ApiResponse) => {
    try {
      const result = await refresher.refresh(req.params.board);
      res.json({
        board: result.board,
        capturedAt: result.snapshot.capturedAt.toISOString(),
        ageSeconds: result.snapshot.ageSeconds,
        cards: result.snapshot.getAllCards().length,
        checklists: result.snapshot.getChecklists().length,
        trelloRequests: result.trelloRequests,
        durationMs: result.durationMs,
      });
    } catch (e) {
      handleWriteError(e, res);
    }
  });

  /************************************** writes *************************************/

  app.put(
    "/api/cards/:cardId/checkItem/:checkItemId",
    async (req: ApiRequest, res: ApiResponse) => {
      try {
        const updated = await relay.setCheckItemState(
          req.params.cardId,
          req.params.checkItemId,
          (req.body || {}).state
        );
        res.json(updated);
      } catch (e) {
        handleWriteError(e, res);
      }
    }
  );

  app.post(
    "/api/checklists/:checklistId/checkItems",
    async (req: ApiRequest, res: ApiResponse) => {
      try {
        const body = req.body || {};
        const created = await relay.addCheckItem(
          req.params.checklistId,
          body.name,
          body.pos || "bottom"
        );
        res.status(201).json(created);
      } catch (e) {
        handleWriteError(e, res);
      }
    }
  );

  app.delete(
    "/api/checklists/:checklistId/checkItems/:checkItemId",
    async (req: ApiRequest, res: ApiResponse) => {
      try {
        await relay.removeCheckItem(
          req.params.checklistId,
          req.params.checkItemId
        );
        res.sendStatus(204);
      } catch (e) {
        handleWriteError(e, res);
      }
    }
  );

  /********************************* static client ***********************************/

  if (existsSync(clientDir)) {
    logger.info(`Serving client from ${clientDir}`);
    app.use(express.static(clientDir));
    /** SPA fallback, but never swallow unmatched /api routes */
    app.get(/^\/(?!api\/).*/, (_req: ApiRequest, res: any) => {
      res.sendFile(join(clientDir, "index.html"));
    });
  } else {
    logger.info(
      `No built client at ${clientDir} — API only. Run "npm run build-client" to serve the UI.`
    );
  }

  app.use("/api", (_req: ApiRequest, res: ApiResponse) => {
    res.status(404).json({ error: "No such endpoint. See /api/docs" });
  });

  return app;
}
