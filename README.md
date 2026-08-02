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

The API pod mounts the same config, cache and log claims as the groomers, so the local PVs'
`nodeAffinity` schedules it onto the same node automatically. Note its memory limit is 512Mi rather
than the groomers' 100Mi: parsing the ToDo snapshot alone costs ~40Mi of heap, and reads across
several boards hold one parsed copy of each.

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
