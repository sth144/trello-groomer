# AGENTS.md

## Project overview
Node.js + TypeScript service that grooms Trello boards via the Trello API (auto-label, auto-link, auto-due, and checklist-driven card creation). Source lives in `src/` and compiles to `dist/`. Config lives in `config/`.

## Repository structure
- `src/`
- `src/index.ts` entrypoint.
- `src/groomer/` board-specific groomers (`todo`, `work`, `media`).
- `src/controller/` Trello board orchestration.
- `src/lib/` utilities, HTTP client, parsers, filters, date helpers, logger, and interfaces.
- `src/model/` domain models.
- `dist/` compiled JS output (generated).
- `config/` runtime configs and `config/templates/` default templates.
- `py/` auxiliary Python tooling (`py/model/label.py`, `py/audible/get_library.py`).
- `util/` helper scripts (`util/start.sh`).
- `log/`, `cache/` runtime artifacts.
- `node_modules/` dependencies.

## Key commands
- Build: `npm run build`
- Start (compiled): `npm run start`
- Start groomers: `npm run start-todo-groomer`, `npm run start-work-groomer`, `npm run start-media-groomer`
- Test: `npm test`

## Conventions and notes
- TypeScript sources in `src/`; do not edit `dist/` directly.
- Config JSONs in `config/` drive behavior; templates in `config/templates/` are the defaults.
- Tests live alongside utilities in `src/lib/*.spec.ts`.
- If changing runtime config shapes, update templates and any parsing logic in `src/lib/`.
