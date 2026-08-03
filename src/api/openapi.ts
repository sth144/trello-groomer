/*************************************************************************************************
 * Hand-maintained OpenAPI 3.0 document. Served as JSON at /api/openapi.json and rendered by      *
 *  swagger-ui-express at /api/docs. Keep this in step with src/api/server.ts.                    *
 *************************************************************************************************/

const checkItemSchema = {
  type: "object",
  properties: {
    id: { type: "string", example: "5f2b8c1e4d3a2b1c0d9e8f70" },
    name: { type: "string", example: "Oat milk" },
    state: { type: "string", enum: ["complete", "incomplete"] },
  },
};

const checklistSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string", example: "Checklist" },
    cardId: {
      type: "string",
      description:
        "Needed to toggle items — Trello keys the checkItem write off the card, not the checklist.",
    },
    total: { type: "integer", example: 19 },
    complete: { type: "integer", example: 7 },
    checkItems: { type: "array", items: checkItemSchema },
  },
};

const viewSchema = {
  type: "object",
  properties: {
    key: { type: "string", enum: ["sprint", "groceries", "research"] },
    label: { type: "string", example: "Groceries & Errands" },
    card: {
      nullable: true,
      type: "object",
      description: "null when the groomer has not created the card yet",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        due: { type: "string", format: "date-time", nullable: true },
        listName: { type: "string", example: "Today" },
        shortUrl: { type: "string", nullable: true },
      },
    },
    checklists: { type: "array", items: checklistSchema },
    capturedAt: {
      type: "string",
      format: "date-time",
      description: "when the groomer wrote the snapshot this response was read from",
    },
    ageSeconds: {
      type: "integer",
      description: "how stale the snapshot is, in seconds",
    },
  },
};

const errorSchema = {
  type: "object",
  properties: {
    error: { type: "string" },
  },
};

const boardParam = {
  name: "board",
  in: "path",
  required: true,
  schema: { type: "string", enum: ["todo", "work", "media", "history"] },
  description: "groomer / board name, matching cache/model.<board>.json",
};

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Trello Groomer API",
    version: "1.0.0",
    description:
      "Read-fast access to the groomer's cached board snapshots, plus write-through " +
      "endpoints that relay check item changes to Trello.\n\n" +
      "**Reads** are served from `cache/model.<board>.json`, which each groomer rewrites at the " +
      "end of every run (ToDo every 5 min, Work and Media every 30 min). No Trello request is " +
      "made, so responses are fast but up to one groom cycle stale — every payload carries " +
      "`capturedAt` and `ageSeconds` so callers can judge for themselves.\n\n" +
      "**Writes** go straight to Trello and are then replayed on top of subsequent snapshot reads " +
      "until a newer snapshot absorbs them, so a toggle is visible immediately.\n\n" +
      "**Auth**: everything here except `/api/health` requires a session from signing in with " +
      "Trello at `/auth/trello`, and only the Trello account that owns the server token is let in. " +
      "Browser requests without a session are redirected to the login; anything else gets a 401.",
  },
  servers: [{ url: "/", description: "this server" }],
  components: {
    securitySchemes: {
      trelloSession: {
        type: "apiKey",
        in: "cookie",
        name: "tg.sid",
        description:
          "Session cookie issued after signing in with Trello at `/auth/trello`. Browsers get " +
          "this automatically; Swagger UI on this page is already carrying it if you can read " +
          "this. Only the Trello account that owns the server token may sign in.",
      },
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description:
          "Shared key for non-browser clients, configured as `apiKey` in config/oauth.json. " +
          "Also accepted as `Authorization: Bearer <key>`. Unset by default.",
      },
    },
  },
  security: [
    { trelloSession: [] as string[] },
    { apiKey: [] as string[] },
  ],
  tags: [
    { name: "views", description: "Resolved Sprint / Groceries / Research cards" },
    { name: "boards", description: "Raw cached board data" },
    { name: "writes", description: "Mutations relayed to Trello" },
    { name: "meta", description: "Health and diagnostics" },
  ],
  paths: {
    "/api/me": {
      get: {
        tags: ["meta"],
        summary: "The signed-in Trello account",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    authEnabled: { type: "boolean" },
                    user: {
                      nullable: true,
                      type: "object",
                      properties: {
                        id: { type: "string", description: "Trello member id" },
                        username: { type: "string" },
                        displayName: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/health": {
      get: {
        tags: ["meta"],
        summary: "Liveness plus snapshot freshness per board",
        description:
          "The only endpoint reachable without signing in — the kubernetes readiness and liveness " +
          "probes depend on it, and gating it would restart-loop the pod.",
        /** empty overrides the document-level requirement: this endpoint needs no session */
        security: [] as unknown[],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    uptimeSeconds: { type: "integer" },
                    trelloRequests: {
                      type: "integer",
                      description: "writes relayed since this process started",
                    },
                    overlayEntries: { type: "integer" },
                    boards: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          board: { type: "string" },
                          capturedAt: { type: "string", format: "date-time" },
                          ageSeconds: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/views": {
      get: {
        tags: ["views"],
        summary: "All three checklist views in one call",
        description:
          "Resolves the current Sprint, Groceries & Errands and Research Tasks cards on the ToDo " +
          "board and returns their checklists. This is the endpoint the Angular client polls.",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "array", items: viewSchema },
              },
            },
          },
          "503": {
            description: "No snapshot on disk yet",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/views/{key}": {
      get: {
        tags: ["views"],
        summary: "A single checklist view",
        parameters: [
          {
            name: "key",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["sprint", "groceries", "research"] },
          },
        ],
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: viewSchema } },
          },
          "404": {
            description: "Unknown view key",
            content: { "application/json": { schema: errorSchema } },
          },
          "503": {
            description: "No snapshot on disk yet",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/boards": {
      get: {
        tags: ["boards"],
        summary: "Boards that currently have a cached snapshot",
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/boards/{board}/lists": {
      get: {
        tags: ["boards"],
        summary: "Lists on a board, with card counts",
        parameters: [boardParam],
        responses: {
          "200": { description: "OK" },
          "503": {
            description: "No snapshot on disk yet",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/boards/{board}/cards": {
      get: {
        tags: ["boards"],
        summary: "Cards on a board",
        parameters: [
          boardParam,
          {
            name: "list",
            in: "query",
            schema: { type: "string" },
            description: "filter to a list by name, e.g. `Today`",
          },
          {
            name: "q",
            in: "query",
            schema: { type: "string" },
            description: "case-insensitive substring match on card name",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 200, maximum: 2000 },
          },
        ],
        responses: {
          "200": { description: "OK" },
          "503": {
            description: "No snapshot on disk yet",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/boards/{board}/cards/{cardId}": {
      get: {
        tags: ["boards"],
        summary: "One card, with its checklists",
        parameters: [
          boardParam,
          { name: "cardId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "OK" },
          "404": {
            description: "Card not in the snapshot",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/boards/{board}/stats": {
      get: {
        tags: ["boards"],
        summary: "Point-in-time board metrics",
        description:
          "Counts as of `capturedAt`. These are not time series — every groomer run overwrites " +
          "the snapshot, so no history is retained to trend against.",
        parameters: [boardParam],
        responses: {
          "200": { description: "OK" },
          "503": {
            description: "No snapshot on disk yet",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/refresh/{board}": {
      post: {
        tags: ["writes"],
        summary: "Rebuild a board from Trello now",
        description:
          "Reads are normally served from the snapshot a groomer left behind, so they go stale " +
          "between runs — indefinitely on a host where no groomer runs at all. This rebuilds the " +
          "board straight from Trello (GETs only, no grooming side effects) and serves it until a " +
          "newer groomer snapshot supersedes it.\n\n" +
          "Costs roughly 12 sequential Trello requests, so call it deliberately rather than per " +
          "page load. Concurrent calls for the same board are coalesced into one rebuild.\n\n" +
          "A rebuild covers only the lists the board's model declares — the month archive lists " +
          "the ToDo groomer imports at run time are not included, so `cards` counts will be lower " +
          "than a groomer-written snapshot's.",
        parameters: [
          {
            name: "board",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["todo", "work"] },
            description:
              "media is not rebuildable here — its model pulls in audio and embedding dependencies " +
              "this process does not otherwise load.",
          },
        ],
        responses: {
          "200": {
            description: "Rebuilt",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    board: { type: "string" },
                    capturedAt: { type: "string", format: "date-time" },
                    ageSeconds: { type: "integer" },
                    cards: { type: "integer" },
                    checklists: { type: "integer" },
                    trelloRequests: { type: "integer" },
                    durationMs: { type: "integer" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Board cannot be rebuilt from Trello",
            content: { "application/json": { schema: errorSchema } },
          },
          "502": {
            description: "Trello could not be reached, or returned nothing usable",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/cards/{cardId}/checkItem/{checkItemId}": {
      put: {
        tags: ["writes"],
        summary: "Toggle a check item, relayed to Trello",
        parameters: [
          { name: "cardId", in: "path", required: true, schema: { type: "string" } },
          {
            name: "checkItemId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["state"],
                properties: {
                  state: { type: "string", enum: ["complete", "incomplete"] },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Trello accepted the change",
            content: { "application/json": { schema: checkItemSchema } },
          },
          "400": {
            description: "Missing or invalid state",
            content: { "application/json": { schema: errorSchema } },
          },
          "502": {
            description: "Trello rejected the write",
            content: { "application/json": { schema: errorSchema } },
          },
          "504": {
            description: "Trello did not answer in time",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/checklists/{checklistId}/checkItems": {
      post: {
        tags: ["writes"],
        summary: "Add a check item, relayed to Trello",
        parameters: [
          {
            name: "checklistId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", example: "Oat milk" },
                  pos: {
                    type: "string",
                    enum: ["top", "bottom"],
                    default: "bottom",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: { "application/json": { schema: checkItemSchema } },
          },
          "400": {
            description: "Missing name",
            content: { "application/json": { schema: errorSchema } },
          },
          "502": {
            description: "Trello rejected the write",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/api/checklists/{checklistId}/checkItems/{checkItemId}": {
      delete: {
        tags: ["writes"],
        summary: "Delete a check item, relayed to Trello",
        parameters: [
          {
            name: "checklistId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "checkItemId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "204": { description: "Deleted" },
          "502": {
            description: "Trello rejected the write",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
  },
};
