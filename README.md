# trello-groomer

[![Build Status](https://travis-ci.com/sth144/trello-groomer.svg?branch=master)](https://travis-ci.com/sth144/trello-groomer)

A Node.js program which will remotely groom Trello board using the Trello API. Can be run as a cron-job to continuously groom the trello board. Available operations include:

- Auto-label cards based on title
- Auto-link related cards based on title
- Auto-assign due dates based on title
- Create new linked cards for items in specially named checklists, with dependency relations (allows sub-tasks)

## API and checklist client

Each groomer writes its whole in-memory board model to `cache/model.<board>.json` at the end of
every run. `src/api` serves those snapshots over HTTP, so a consumer gets board state in one local
request instead of the ~12 sequential Trello calls `buildModel()` costs.

```bash
npm run build          # compile the groomers and the API
npm run start-api      # listens on :4500

npm run build-client   # install + build the Angular client (served by the API when present)
npm run start-client-dev  # ng serve on :4200, proxying /api to :4500
```

- **Docs**: `http://localhost:4500/api/docs` (Swagger UI), spec at `/api/openapi.json`
- **One call for all three checklists**: `GET /api/views` resolves the current Sprint,
  Groceries & Errands and Research Tasks cards and returns their checklists
- **Raw board data**: `/api/boards/:board/{lists,cards,cards/:cardId,stats}`
- **Writes**: `PUT /api/cards/:cardId/checkItem/:checkItemId` and the `/api/checklists/...`
  endpoints relay straight to Trello, which stays the source of truth

Two things worth knowing about freshness:

- Reads are as stale as the last groomer run (ToDo every 5 min, Work and Media every 30). Every
  response carries `capturedAt` and `ageSeconds` so callers can decide for themselves.
- `POST /api/refresh/:board` rebuilds a board from Trello on demand for hosts where no groomer
  runs. It issues GETs only — no grooming side effects — and takes tens of seconds, so it is never
  triggered on a read.

Writes are replayed on top of subsequent snapshot reads until a newer snapshot absorbs them, so a
ticked box does not spring back on the next poll.

The client (`client/`) is a standalone Angular app with its own `package.json`, kept separate so its
toolchain does not collide with this project's TypeScript and RxJS versions.

### Authentication

The client and the whole API sit behind Trello OAuth. Only the Trello account that owns the server
token in `config/key.json` can sign in — the allowlist is resolved from Trello at first login rather
than hardcoded, so revoking the token revokes access.

Trello is the identity provider rather than Google for a practical reason as well as a tidy one: its
OAuth takes the return URL at request time instead of pre-registering one, and it accepts plain HTTP
and bare IPs. Google rejects both, so Google login would require a public HTTPS hostname before it
could work at all.

Create `config/oauth.json` from `config/templates/oauth.template.json`:

```bash
cp config/templates/oauth.template.json config/oauth.json
# consumerSecret: the *Secret* from https://trello.com/app-key (not the server token)
# sessionSecret: openssl rand -hex 32
```

**The API refuses to start without it.** That is deliberate — a deployment that silently served an
open API would be worse than a pod reporting NotReady. For local development only,
`ALLOW_UNAUTHENTICATED=true` skips it. Secrets may also come from `TRELLO_CONSUMER_SECRET` and
`SESSION_SECRET` if you would rather use a Kubernetes Secret than the config volume.

Notes:

- `/api/health` is the one ungated endpoint, because the readiness and liveness probes hit it.
- Non-browser clients (cron, scripts) can set an `apiKey` in the config and send it as `X-API-Key`
  or `Authorization: Bearer`. Unset by default.
- The same deployment works on the LAN over HTTP and remotely over HTTPS. The callback is a relative
  path and the app sets `trust proxy`, so it resolves against whichever origin was used, following
  `X-Forwarded-Proto` / `X-Forwarded-Host` through the ingress. Cookies are per-origin, so signing in
  on the LAN and remotely are separate sessions.
- Leave `secureCookie` false while any origin is plain HTTP; a Secure cookie is never sent over HTTP,
  so enabling it breaks LAN access. Turn it on once everything is HTTPS.

### Deploying the API

The image builds the client in its own stage and copies only the emitted bundle into the deploy
image, so the Angular dependencies never ship. `.trello-groomer.deploy.yml` adds a
`trello-groomer-api` Deployment and a NodePort Service alongside the three groomers:

```bash
docker build --target deploy -t sthinds/trello-groomer:latest .
docker push sthinds/trello-groomer:latest
kubectl apply -f .trello-groomer.deploy.yml
```

Reachable at `http://<node-ip>:30450` — `/` for the client, `/api/docs` for Swagger.

The API pod mounts the same config, cache, log and CA-certificate volumes as the groomers, and is
pinned to the same node. It sits inside the groomers' resource envelope (500Mi limit, 200Mi request):
the container measured 102.7MiB after parsing the ToDo snapshot and running a full refresh.

## TODO:

### Deployment

- get Docker build working
- get Kubernetes deployment working
- get rid of deploy.sh and launch.sh

### Auto-label

- is label.py creating any output in Docker image?
- integrate stopwords into auto-label
- get rid of auto-label based on single shared word?
- stemmer
  - still want un-stemmed words in auto-label.config.json file...
- get ML model working
  - get stemming working
  - reconcile with synced config files (merge?)
  - migrate to neural net

### Due-date Reassignment

- take into account original due date when calculating new date

### Tasks

- prettify JSON in auto-\_\_\_.config cards
