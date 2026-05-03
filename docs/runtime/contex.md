# Runtime Context

> This file tracks the current working state of the project. Update it as decisions are made and work progresses.

---

## Current Status

**Phase:** Active development — API scaffolded, auth module (Google OAuth) implemented and tested.

---

## Stack Decisions (as of 2026-05-02)

| Concern         | Decision                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| Database        | Cloudflare D1 (SQLite)                                                   |
| API runtime     | Cloudflare Workers                                                       |
| API framework   | Hono                                                                     |
| Migrations      | Wrangler D1 migrations                                                   |
| UUID generation | `crypto.randomUUID()` in app layer                                       |
| Auth            | Direct Google OAuth 2.0 — implemented in Workers (ADR-005)               |
| Frontend        | Multiple apps, one per competition (e.g., `brasileirao.palpitae.com.br`) |

Full rationale in [`docs/architecture/decisions.md`](../architecture/decisions.md).

---

## Schema

Full DER and migration SQL in [`docs/architecture/schema.md`](../architecture/schema.md).

### Key rules encoded in schema

- Prediction uniqueness: `UNIQUE (user_id, group_id, match_id)`
- Prediction lock: derived from `match.start_time` at runtime — no `locked_at` column
- Group membership uniqueness: `UNIQUE (group_id, user_id)`
- Match deduplication: `UNIQUE (external_id, provider)`
- Team deduplication: `UNIQUE (external_id, provider)`
- Leaderboard is materialized: updated when match status → `finished` or score changes

---

## Open Decisions

- [x] Auth provider: Direct Google OAuth 2.0 (see ADR-005) — no third-party SaaS, no MAU limits
- [ ] Payment provider — deferred; decide when building the payments module. Schema is provider-agnostic.
- [ ] Admin panel approach — deferred; not needed for core API.

---

## Build Order

1. Auth (Google OAuth)
2. Competitions + Matches (sync/seed)
3. Groups + Members
4. Predictions
5. Leaderboard
6. Payments ← decide provider here
7. Admin panel ← last

## Next Steps

1. ~~Initialize Cloudflare Workers project (`npm create hono@latest`)~~ ✅
2. ~~Configure D1 binding in `wrangler.toml`~~ ✅
3. ~~Run first migration (`wrangler d1 migrations create initial_schema`)~~ ✅ (file ready at `api/migrations/0001_initial_schema.sql`)
4. ~~Start API — auth module first~~ ✅

**To activate the API:**

1. Create D1 database: `wrangler d1 create palpitae` → paste the `database_id` into `api/wrangler.toml`
2. Apply migration: `wrangler d1 migrations apply palpitae --local`
3. Copy `.dev.vars.example` → `.dev.vars` and fill in Google OAuth credentials
4. Run locally: `wrangler dev`

**Next build step:** Competitions + Matches (sync/seed)

---

## ~~Legacy SQL Draft~~

> The PostgreSQL schema draft that was previously here has been superseded by the D1-adapted schema in `docs/architecture/schema.md`. PostgreSQL is no longer the target platform (see ADR-001).
