# Architecture Decision Records

## ADR-001: Database Platform — Cloudflare D1

**Status:** Accepted
**Date:** 2026-05-02

### Context

Palpitae runs on Cloudflare infrastructure (Workers, free tier). The database must integrate natively with Workers without HTTP overhead. PostgreSQL (previously listed in AGENTS.md) conflicts with the Cloudflare-first infrastructure decision.

### Decision

Use **Cloudflare D1** (SQLite) as the primary database.

### Consequences

- No PostgreSQL extensions (`uuid-ossp`, etc.) — UUIDs generated in the application layer (e.g., `crypto.randomUUID()`)
- All timestamps stored as `TEXT` in ISO 8601 UTC format (`datetime('now')`)
- Foreign key enforcement requires `PRAGMA foreign_keys = ON` per connection
- `CHECK` constraints are supported in SQLite
- Schema adapted for SQLite syntax throughout

---

## ADR-002: Migration Strategy — Wrangler D1 Migrations

**Status:** Accepted
**Date:** 2026-05-02

### Context

Database changes must be versioned, reproducible, and auditable across local dev and production. Options considered: one-shot SQL script, Wrangler native migrations, ORM-managed migrations.

### Decision

Use **Wrangler D1 migrations** (`wrangler d1 migrations`).

- Each change is a versioned `.sql` file under `migrations/`
- Wrangler tracks applied migrations in a `d1_migrations` table automatically
- Migrations can be run locally (`--local`) and against production (`--remote`)
- All migration files are committed to version control

### Rules

- Create with: `wrangler d1 migrations create <description>`
- **Never edit an already-applied migration** — create a new one instead
- Every schema change, index addition, or data backfill requires a new migration file

### Consequences

- Clean audit trail of all schema changes
- Reproducible setup: `wrangler d1 migrations apply` from scratch recreates the full schema

---

## ADR-003: API Runtime — Cloudflare Workers + Hono

**Status:** Accepted
**Date:** 2026-05-02

### Context

Backend must be lightweight, globally distributed, and natively integrated with D1. Options considered: Node.js (Hono/Fastify), Cloudflare Workers (Hono).

### Decision

Use **Cloudflare Workers** with the **Hono** framework.

### Consequences

- Zero cold start, edge-native execution
- D1 accessed via `env.DB` binding — no HTTP overhead
- Node.js APIs not available; use Web Standard APIs
- Local development via `wrangler dev`

---

## ADR-004: Prediction Locking — Derived at Runtime

**Status:** Accepted
**Date:** 2026-05-02

### Context

Predictions must be locked after `match.start_time`. Options: store `locked_at` on the prediction row, or derive lock status from `match.start_time` at query time.

### Decision

**Derive prediction lock from `match.start_time` at runtime.** No `locked_at` column on `predictions`.

### Consequences

- Lock check: `IF now() >= match.start_time THEN reject edit`
- If a match is rescheduled, predictions automatically unlock/relock based on the new time — no stale data
- Simpler schema, no risk of `locked_at` going out of sync with match data

---

## ADR-005: Authentication — Direct Google OAuth 2.0

**Status:** Accepted
**Date:** 2026-05-02

### Context

The product requires Google sign-in. Options evaluated:

| Option                  | Free tier limit | Cost risk                 |
| ----------------------- | --------------- | ------------------------- |
| Firebase Auth           | 50k MAU         | Billing surprise at scale |
| Supabase Auth           | 50k MAU         | Billing surprise at scale |
| Clerk                   | 5k MAU          | Hits limit early          |
| **Direct Google OAuth** | None            | Always free               |

The core constraint is **zero cost unless genuinely needed**. All third-party auth SaaS products impose MAU limits that create unpredictable billing as the product grows.

### Decision

Implement **direct Google OAuth 2.0 (Authorization Code flow)** in the Hono API. No third-party auth SaaS.

- Frontend redirects user to Google consent screen
- API handles the OAuth callback, exchanges code for ID token
- Verify ID token signature using Google's public keys (JWKS endpoint)
- Create or update user row in D1 based on `email` + `provider_id`
- Issue a signed JWT (session token) stored as an `httpOnly`, `Secure`, `SameSite=Lax` cookie

### Security Requirements

- Use `state` parameter (CSRF protection) and PKCE on the OAuth flow
- Validate `nonce` in the ID token
- JWT signed with a strong secret stored in Workers secrets (not code)
- Token expiry enforced server-side

### Consequences

- No MAU limits, no third-party billing
- ~200 lines of auth implementation to own and maintain
- Full control over session lifecycle and user model
- Google's public JWKS endpoint must be fetched and cached (rotates periodically)

---

## ADR-007: Result Sync Strategy — Cron-Triggered Time-Window Poller

**Status:** Accepted
**Date:** 2026-06-16

### Context

Match results must be fetched from football-data.org and scored against user predictions as soon as matches finish. The original approach (`maybeSyncResults`) fires as a `waitUntil` task on every `GET /matches` request — it calls the external API if any match started more than 3 hours ago and isn't marked `finished` yet.

This has two structural problems:

1. **Depends on user traffic.** If no one opens the app during or after a match, scoring never happens.
2. **Imprecise trigger window.** A fixed 3-hour threshold doesn't reflect actual match structure — it fires too early (matches are still running) or too late (missed results from previous matches).

### Decision

Add a **Cron Trigger** to the existing `palpitae-api` Worker that runs every **30 minutes** (on the hour and half-hour: `0,30 * * * *`) and polls only during the proven active window for each match.

**Timing math:**

```
First half:           45 min
First half stoppage:   5 min
Half-time interval:   15 min
Second half:          45 min
Second half stoppage:  5 min
─────────────────────────────
Minimum match length: 115 min  ← start polling here
```

The poller starts checking at `start_time + 115 min`. The upper bound is `start_time + 200 min`, which covers knockout rounds (extra time: 30 min + ~10 min stoppage + penalty shootout: ~15 min), with margin.

**Query:** select distinct `(competition, round)` pairs whose matches are in the active window.

```sql
SELECT DISTINCT c.id AS comp_id, c.external_id, c.season, m.round
FROM matches m
JOIN competitions c ON c.id = m.competition_id
WHERE m.start_time <= ?  -- now − 115 min (ISO 8601, computed in JS)
  AND m.start_time >= ?  -- now − 200 min (ISO 8601, computed in JS)
  AND m.status != 'finished'
  AND c.provider = 'football-data'
```

> **Note:** the window bounds are computed in JS with `new Date(...).toISOString()` and bound as parameters, **not** via SQLite's `datetime('now', ...)`. `start_time` is stored as ISO 8601 with `T`/`Z` (`2026-06-16T22:00:00Z`, per ADR-001), and `datetime()` returns a space-separated form (`2026-06-16 23:21:20`). Since `start_time` is `TEXT`, the comparison is lexicographic — the `T` (ASCII 84) vs space (ASCII 32) at position 10 makes `start_time <= datetime(...)` always false. Computing the bounds in JS keeps both sides in the same ISO format (matching the existing `maybeSyncResults` convention).

For each active round, call `syncFixtures` scoped to that `matchday` (numeric rounds = group stage). Non-numeric rounds (knockout phases) fall back to a full-competition fetch. After syncing a competition's active rounds, run `scoreUnprocessedMatches` once for that competition. If a match is not yet finished according to the API, the next 30-minute tick tries again automatically.

**`maybeSyncResults` is kept** in the `GET /matches` request path as a fallback for now; it will be removed once the Cron is stable in production.

### Alternatives Considered

**Multi-source cascading poller (football-data → API-Football → scraper)**
Polls multiple APIs/sites every 5–10 minutes and falls through to the next source when one fails or rate-limits.

- Rejected: overkill at this scale. Copa do Mundo 2026 has at most 3 games/day. football-data.org free tier allows 10 req/min — we'll never hit the limit with ~1 call per active round per 30-minute tick. Adds significant maintenance surface with no concrete benefit today.

**Keep current (lazy request-triggered)**

- Rejected: depends on user traffic; broken for low-traffic periods or early morning matches.

### Implementation

The Cron Trigger is added to the **existing `palpitae-api` Worker** (not a separate service), since it shares the same D1 binding and `FOOTBALL_API_KEY` secret. No new deployment pipeline is needed.

- New file: `api/src/matches/poller.ts` — contains the active-window query and orchestration
- `api/src/index.ts` — default export becomes `{ fetch, scheduled }`; the `scheduled` handler calls the poller
- `api/wrangler.toml` — adds `[triggers] crons = ["0,30 * * * *"]`
- `api/src/matches/router.ts` — unchanged for now; `maybeSyncResults` stays as a fallback until the Cron is proven in production

### Consequences

- Results are scored within at most 30 minutes of a match finishing, regardless of user traffic. Matches start on the hour or half-hour; the active window is 85 min wide (200 − 115), so at most one tick passes between match end and scoring.
- `GET /matches` is now a pure DB read — no background API calls piggybacking on user requests
- football-data.org is called only while matches are actively in their time window — no wasted polling
- Knockout extra time and penalties are covered by the 200-min upper bound; if still not finished, the next day's manual admin sync catches edge cases
- If football-data.org is down during a tick, the next tick retries automatically; the scoring gap is bounded by the 30-min cron interval
- During the transition, both the Cron and `maybeSyncResults` may sync — this is safe because `scoreUnprocessedMatches` is idempotent (skips matches with `scored_at` set)

---

## ADR-008: Caching Strategy for `GET /matches` — Content-Derived TTL + Edge Cache API

**Status:** Accepted
**Date:** 2026-06-17

### Context

`GET /matches` is the highest-traffic read in the app. D1 bills per **row read/written**, so responses are cached to limit reads. The original `Cache-Control` was chosen from the `status` **query param**: the no-status form (the only one the frontend uses) fell into a default of `max-age=3600, stale-while-revalidate=86400`.

But that response is a **mixed list** (scheduled + live + finished). When a live match transitioned to `finished` and was scored by the Cron (ADR-007), the browser/CDN kept serving the stale "ao vivo" snapshot for up to 1h (and up to 24h under `stale-while-revalidate`). The Cron and scoring were correct — the bug was purely cache staleness on the read path.

### Decision

1. **Derive `Cache-Control` from the response _contents_, not the query param.** A list is only safe to cache long-term when every match is `finished` (a terminal state):
   - all `finished` → `max-age=86400` (never changes)
   - any `live` → `max-age=30`
   - otherwise / empty → `max-age=60` (a `scheduled` match flips to `live` at kickoff)
2. **Add an explicit edge cache via the Cache API** (`caches.default`), keyed by request URL. A hit returns before querying D1, saving rows read and sharing the result across users in the same colo. Worker-generated responses are **not** edge-cached by `Cache-Control` alone, so the `put()` is explicit.
3. **Frontend:** align the in-memory `fetchCachedJson` TTL for matches to 30s across `DashboardPage`, `PredictionsTab`, `GroupPicksTab` (was 5 min in the latter two).

### Consequences

- A `live → finished` transition is reflected within ~30s instead of up to 1h.
- Finished rounds are still cached 24h — that's the bulk of long-lived cacheable traffic.
- **No extra infra cost:** the Cache API is not billed per operation or for storage. It is best-effort and **per-colo** (may be evicted), so correctness never depends on it.
- **D1 cost stays negligible:** reads are cheap and the free tier is generous (~5M rows/day); `GET /matches` reads ~120–216 rows. The short TTLs add a trivial number of reads.
- The **Cron does not use this endpoint** — it queries D1 directly via the binding — so result freshness is unaffected by these TTLs.
- `maybeSyncResults` still fires on cache **misses**; on hits it is skipped, which is fine because the Cron (ADR-007) is the primary sync path.

---

## ADR-009: Round Reminder Notifications — Transactional E-mail via Resend

**Status:** Accepted
**Date:** 2026-06-19

### Context

When a competition moves to a new round, many users fail to submit predictions for it. Observed cause: the round selector in the UI is easy to miss, so users don't notice a new round opened. We want to nudge users **one day before a new round starts**.

Constraints:

- **Zero cost** (same principle as ADR-005). The product runs on free tiers.
- We only have users' **e-mail** today (from Google OAuth, ADR-005). No phone numbers.
- The reminder must run **without depending on user traffic** — same reasoning as the result poller (ADR-007). A Cron Trigger fits.

Channels evaluated:

| Channel | Cost | Reach without extra opt-in | Verdict |
| --- | --- | --- | --- |
| **E-mail** | Free tier | Yes — we already have addresses | **Chosen** |
| Web Push (browser) | Free | No — needs per-user permission prompt (~10–20% accept), and whoever most needs the nudge is least likely to accept | Future |
| WhatsApp | Free only via unofficial libs (ToS risk, ban risk) | Needs phone numbers we don't have | Rejected |
| Telegram bot | Free | Needs users to follow a bot | Rejected |
| SMS | Paid | Needs phone numbers | Rejected |

### Decision

Send a **transactional e-mail** one day before a round's first match, via **[Resend](https://resend.com)**.

- **Sending domain:** `palpitae.com.br` (root domain). Verified in Resend via DNS records (MX, SPF, DKIM) hosted on Cloudflare; DKIM must be set to **DNS Only** (no orange-cloud proxy).
- **Sender:** `lembretes@palpitae.com.br` — endereço respondível (não "noreply"), que melhora engajamento e evita sinais de bulk/Promotions no Gmail. Requer rota no Cloudflare Email Routing. Links **sem** parâmetros UTM e HTML enxuto (link de texto, sem botão/logo) pelo mesmo motivo — abriu-se mão da atribuição GA4 do e-mail em troca de inbox placement.
- **Trigger:** a second **Cron Trigger** on the existing `palpitae-api` Worker, `"0 10 * * *"` (daily at 10:00 UTC / 07:00 BRT). Differentiated from the result poller (ADR-007) by `controller.cron` in the `scheduled` handler.
- **Provider seam:** the Resend-specific HTTP call is isolated in `api/src/notifications/email.ts` (`sendEmail({ to, subject, html })`). The reminder logic knows nothing about Resend. Swapping providers means rewriting only that one file.

**Idempotency without a dedupe table.** Two layers guarantee exactly one e-mail per user per round, so no `notification_log` table is needed:

1. The reminder runs **once a day** (daily cron), not every 30 min.
2. The query only selects a round when **tomorrow is its first match day** — a correlated subquery requires `date(start_time) = MIN(date(start_time))` over that `(competition, round)`. A round spanning multiple days therefore notifies only on the eve of its first match, never mid-round.

Accepted tradeoff: if the daily cron fails and Cloudflare re-invokes it, a re-send is possible. Volume is tiny, so this is acceptable; if it ever matters, add `notification_log (user_id, competition_id, round, sent_at)`.

**Coupled to `default_round`.** The reminder must never promote a round before the app itself shows it. So the query adds a third gate: the round must equal the competition's `default_round` — the earliest round still open (`HAVING MAX(start_time) > now ORDER BY MAX(start_time) ASC LIMIT 1`). This is the **same subquery** used by `GET /matches` (`api/src/matches/router.ts`); keep the two in sync. Consequence: if rounds are back-to-back (round N starts the same day round N-1's last match is played), on the eve of N the default is still N-1, so the reminder is **suppressed** rather than sent early. Suppressing a reminder is preferred over sending one before the round is the active one. A rest day between rounds (the normal case) lets it fire on the eve as intended.

**CTA attribution.** The CTA link carries `utm_source=email&utm_medium=email&utm_campaign=round_reminder` so GA4 (auto-captures `utm_*`) attributes site visits opened from the e-mail. Server-side, each send logs `email_reminder_sent` (with `user_hash`, not the e-mail) and the run logs `cron_round_reminder` (`rounds`, `sent`, `failed`) to Analytics Engine.

**Opt-out (LGPD).** Default is opt-in. Suppression is controlled in-app, not by Resend (Resend auto-manages unsubscribes only for its Broadcasts product, not API/transactional sends). `users.email_unsubscribed_at` (NULL = subscribed; migration 0007). The reminder query adds `AND u.email_unsubscribed_at IS NULL`. Each e-mail carries a footer "Cancelar inscrição" link plus RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post: One-Click` headers (Gmail/Apple native button). The link/header point at `GET|POST /notifications/unsubscribe?token=…`. The token is a **dedicated HMAC** (`notifications/unsubscribeToken.ts`), **not** a JWT — reusing the session JWT would turn an unsubscribe URL into a bearer credential; the token carries only the user id, no expiry. Users re-subscribe from the in-app settings page (`/configuracoes` → `GET|PATCH /notifications/preferences`). Events: `email_unsubscribed` / `email_resubscribed` (with `source` = `link`|`settings`).

### Alternatives Considered

**E-mail provider — why Resend.** All options below have a permanent free tier and require no credit card to start. The product's chief fear is a provider cutting its free tier with little notice (as Mailgun did historically), so provider age and free-tier track record were weighed alongside limits. Figures as of 2026-06-19:

| Provider | Founded | Free tier | Risk notes |
| --- | --- | --- | --- |
| **Resend** (chosen) | 2022 | 3,000/mo · 100/day · 1 domain | Young (VC-backed) but transparent terms, modern API, official CLI + MCP server. Limits comfortably exceed our volume. |
| Brevo (ex-Sendinblue) | 2012 | 300/day · 9,000/mo | Best free-tier stability record; profitable, not VC-dependent. Strong fallback. |
| Elastic Email | 2010 | ~37,500/mo (~1,250/day) | Highest free volume, but less widely used; stability harder to assess. |
| SendGrid | 2009 | Trial only; standalone pricing folded into Twilio | Acquired by Twilio (2019); free tier degraded — the cautionary case. |
| Mailgun | 2010 | 100/day, 1-day log retention | Cut its free tier sharply in the past — the original reason for the "free tier could vanish" fear. |

Resend was chosen for the modern DX (clean API, CLI, official MCP server) and limits that comfortably exceed our volume. **Brevo is the designated fallback** if Resend's free tier changes; the provider seam (`email.ts`) makes the swap a one-file change.

**Cloudflare-native e-mail.** Cloudflare Email Routing only *receives*/forwards mail; it does not send transactional e-mail to arbitrary recipients. So Cloudflare hosts the DNS records but the send itself goes through Resend.

**Separate Worker / queue for sending.** Rejected — overkill at this volume. The existing Worker already has the D1 binding and Cron infra; one extra cron expression and one secret is the whole delta.

### Implementation

- New file `api/src/notifications/email.ts` — provider seam (`sendEmail`), the only Resend-aware code.
- New file `api/src/notifications/roundReminder.ts` — the active-round query, per-round grouping, HTML template, and per-user send with isolated failures.
- `api/src/index.ts` — `scheduled` handler branches on `controller.cron`: `"0 10 * * *"` → reminders, else → poller (ADR-007).
- `api/wrangler.toml` — `crons = ["0,30 * * * *", "0 10 * * *"]`; documents `wrangler secret put RESEND_API_KEY`.
- `api/src/types.ts` — `RESEND_API_KEY` added to `Env`.

**External setup (one-time, not code):** create the Resend account + API key, add `palpitae.com.br`, add its MX/SPF/DKIM records in Cloudflare (DKIM as DNS Only), verify in Resend, then `wrangler secret put RESEND_API_KEY`.

### Consequences

- Users are reminded the day before each new round opens, with no extra opt-in beyond their existing account.
- No new infra: reuses the Worker, its D1 binding, and the Cron mechanism. One secret added.
- Provider lock-in is contained to `email.ts` — switching to Brevo (or any provider) is a single-file change.
- No dedupe table; correctness rests on the once-a-day cron + first-match-day query. A rare cron re-invocation could double-send (acceptable at this scale).
- Date math is in **UTC** (`date(start_time)` vs `date('now', '+1 day')`). Matches near the UTC day boundary could be attributed to the adjacent day; immaterial for a "day before" reminder.
- E-mail is sent **per user** (no shared BCC) so addresses never leak between participants; a single failed send is logged and skipped without aborting the batch.
- No opt-out mechanism yet — to add if users request it.

---

## ADR-010: Fixture Discovery — Daily Full-Competition Sync Cron

**Status:** Accepted
**Date:** 2026-06-28

### Context

The DB is seeded one round at a time. In short tournaments (World Cup, Euro) the next phase's fixtures don't exist when the group stage starts — knockout matchups are defined *gradually* as each group finishes, and football-data.org only exposes a fixture once the teams are known. Until now the only way to pull a new phase into the DB was to **manually** call `POST /matches/sync`. With the group stage ending and the round of 32 starting the next day, new fixtures need to land automatically.

The result poller (ADR-007) doesn't cover this: it only fetches matches already in the DB that are inside their active result window. It scores existing fixtures — it never discovers fixtures that aren't there yet.

### Decision

Add a **third Cron Trigger** to the `palpitae-api` Worker, `"0 6 * * *"` (daily at 06:00 UTC / 03:00 BRT — a window with no live matches), differentiated by `controller.cron` in the `scheduled` handler. It runs `discoverFixtures` (`api/src/matches/fixtureDiscovery.ts`):

1. Query competitions with `status != 'finished'`, `provider = 'football-data'`, `external_id IS NOT NULL`.
2. For each, call `syncFixtures` **without a `matchday` filter** — fetches the whole tournament.
3. Run `scoreUnprocessedMatches` for that competition (re-scores anything a score correction left unscored).

Per-competition failures are isolated (one bad comp doesn't abort the rest) and logged as `football_api_error`. The run emits a `fixture_discovery_run` health event (`competitions`, `fixtures_updated`, `api_calls`, `duration_ms`).

### Why a full sync (not "wait for the round to end")

The first instinct — detect the last match of the current round, then fetch the next round — has two failure modes: (1) waiting for the **last** group to finish leaves the first-defined knockout matchups with almost no prediction window, since their first match can be the next day; (2) a postponed match would stall discovery indefinitely. An **unconditional** daily full sync sidesteps both: `syncFixtures` is idempotent (`ON CONFLICT` by `external_id`), so re-fetching the whole tournament only updates changed kickoff times and inserts newly-defined fixtures — no duplicates. New knockout matchups appear the morning after football-data publishes them, maximizing prediction lead time. Cost is **1 API call per active competition per day**.

### Why not reuse the existing crons

- The poller (`0,30 * * * *`) is scoped to the active result window and scoped by `matchday`; widening it to full-tournament fetches every 30 min would waste football-data quota for no benefit and mix two concerns (scoring vs discovery).
- A separate daily cron keeps discovery cheap, off-peak, and independently observable.

### Consequences

- New phases (round of 32, 16, …) and kickoff-time changes land automatically each morning — no manual `POST /matches/sync`.
- No new infra: reuses the Worker, its D1 binding, and `FOOTBALL_API_KEY`. One cron expression added (`crons = ["0,30 * * * *", "5 0 * * *", "0 10 * * *", "0 6 * * *"]`).
- At 06:00 UTC the poller's `0,30 * * * *` also matches, but Cloudflare fires `scheduled` once **per** matching cron with its own `controller.cron`, so the two don't collide.
- **Known limitation:** nothing currently promotes a competition's `status` to `'finished'`, so `status != 'finished'` never narrows — discovery fetches every football-data competition (including past seasons) daily. Harmless at current scale (≈1 competition, 1 call/day); revisit by flipping `status` once all matches are `finished`, or filtering by `season`, if multiple finished competitions accumulate.
- `POST /matches/sync` (ADR predecessor, manual) is kept as an admin escape hatch.

---

## ADR-006: Frontend Stack — Vite + React (Static Site)

**Status:** Accepted
**Date:** 2026-05-03

### Context

The vision describes multiple frontend apps — one per competition — sharing a common design system. The API is stateless REST over HTTP with cookie-based auth. No SSR, no complex routing, and no data fetching framework is needed at this stage.

### Decision

Use **Vite + React (TypeScript)** as a static site under `web/`.

- Source lives in `web/src/`; built output is a static bundle in `web/dist/`
- No SSR, no meta-framework (Next.js, Remix, etc.)
- Styles via CSS Modules + CSS custom properties (design tokens)
- No UI component library — components are hand-built against the design token system
- API base URL injected at build time via `VITE_API_URL` (`.env.development` / `.env.production`)

### Design Token System

All visual values (colors, spacing, typography, shadows, radii) are declared as CSS custom properties in `web/src/styles/variables.css`. Components reference tokens via `var(--token-name)` — no raw values in component stylesheets.

**Brand palette (from `/assets/*.svg`):**
| Token | Value | Usage |
|---|---|---|
| `--color-primary` | `#49f21b` | CTAs, highlights, brand accent |
| `--color-bg` | `#0d0d0d` | Page background |
| `--color-surface` | `#1a1a1a` | Card / panel surfaces |
| `--color-text-primary` | `#ffffff` | Main text |

### Why not Next.js / Remix?

- No server-side rendering needed — data is user-specific and loaded after auth
- Cloudflare Workers serves the API; static assets can be served via Cloudflare Pages
- Keeps frontend dependencies minimal and deployment simple

### Consequences

- Each competition app will be its own Vite project with shared token conventions
- No framework router lock-in; client routing added only when needed (e.g., React Router)
- CSS Modules keep styles scoped to components with zero runtime overhead
- `vite preview` or Cloudflare Pages serves the static dist for production

---

## ADR-011: Brasileirão Série A 2026 — Data Migration from bolao-brasileirao

**Status:** Accepted (executed in prod on 2026-07-12)
**Date:** 2026-07-12

### Context

Before Palpitae, the same friend group ran the season on **bolao-brasileirao** — a separate app (own repo, own D1) that was Palpitae's MVP. Goal: consolidate into Palpitae, preserving 18 rounds of history (773 predictions, 6 players) in a shared group, and let Palpitae take over the remaining season with the same sync/scoring pipeline used for the World Cup.

Both apps use football-data.org and competition 2013 (BSA), so `bolao.matches.api_match_id` ≡ `palpitae.matches.external_id` — match mapping is a direct join. Scoring rules are identical (3 exact / 1 outcome / 0); a SQL recompute of all 773 stored points against the rule found **0 divergences**, so "preserve old points" and "recompute under Palpitae rules" are the same numbers.

### Decision

Migrate via **idempotent one-off SQL applied with `wrangler d1 execute --remote`** — no application code changes, no schema changes, no migration files. Palpitae was already competition-generic; the only missing piece was data. Artifacts live in [`docs/bolao-migration/`](../bolao-migration/README.md):

1. Seed the competition row (slug must equal what `syncFixtures` derives — it's the upsert conflict key).
2. Seed teams + 380 matches with the **same conflict keys** as `syncFixtures` (`(external_id, provider)`), so the daily discovery cron reconciles over the manual seed with no duplicates. (Manual seed instead of waiting for the cron: the competition row was created after that day's 06:00 UTC run.)
3. Create the group (3/1/0, `predictions_visibility='hidden'` ≈ the old app's cutoff behavior) + 6 members.
4. Import predictions with `points_awarded` copied from the source and `ON CONFLICT DO NOTHING`; match resolved at apply time via subselect on `external_id`.
5. Recalculate the leaderboard with the same aggregation as `recalculateLeaderboard`.

Old-app identities (`participant_name` strings) were mapped to Palpitae users by an owner-provided name→email table; two spelling variants (WEEGEE/WEEGGE) were the same person (0 overlapping matches) and merged.

### Consequences

- Leaderboard verified identical to the source app (106/98/88/61/54/42; 773/773 rows imported).
- Matches seeded with `scored_at = NULL`: the next `scoreUnprocessedMatches` run re-scores them — a no-op for already-correct imported points, and it awards the ~21 matches that finished after the old app's last sync (totals rise; correct behavior).
- Prediction locking semantics change for the group: old app locked the whole round at a cutoff; Palpitae locks per match at kickoff.
- Per-round ranking (old app feature) has no Palpitae view; imported data allows deriving it later if missed.
- bolao-brasileirao becomes read-only and is retired separately.

---

## ADR-012: Standings Tab — Data-Driven Competition-Type Gate

**Status:** Accepted
**Date:** 2026-07-13

### Context

The Tabela (standings) tab was removed from the group page because it only served the World Cup group stage. With the Brasileirão Série A in the product (ADR-011), a round-robin league where the standings are the core view, the tab needs to come back — but only for leagues.

### Decision

Gate by a new `competitions.type` column (`'league' | 'cup'`, migration 0012), the same per-competition data-driven pattern as `penalty_phases` (ADR pattern: fail-closed). Default `'cup'` = no standings; leagues are marked explicitly. The API exposes `competition_type` on the group endpoints; the frontend renders the tab only for league groups and falls back to the default tab when `?tab=standings` is forced on a cup group.

`computeStandings` buckets league matches (`phase === 'REGULAR_SEASON'`, no `group_name`) into a single table keyed by the exported `LEAGUE` sentinel; cup knockout matches stay excluded. League sorting approximates CBF criteria (points, wins, goal difference, goals for — head-to-head and cards are not synced); cup groups keep FIFA (points, GD, GF).

### Consequences

- New leagues need one `UPDATE competitions SET type='league'` — no code change.
- Deploy coupling: the group endpoints select `c.type`, so migration 0012 must be applied before the API deploy (done for prod on 2026-07-13).
- football-data.org already classifies competitions (`type: LEAGUE|CUP`); if competition creation is ever automated, the column can be filled from the provider.

---

## ADR-013: Postponed Matches — Dedicated Flag, Not a `status` Value

**Status:** Accepted
**Date:** 2026-08-01

### Context

Rodada 21 do Brasileirão 2026 teve 4 jogos adiados (Mineiro×Bragantino, Botafogo×Grêmio, Chapecoense×Vasco, São Paulo×Santos). O Palpitae não refletiu o adiamento — e não foi falha de cron: o `discoverFixtures` (ADR-010) rodou e leu os dados certos. O pipeline é que não tinha como representar o estado.

Duas coisas se somavam:

1. `mapStatus()` (`api/src/matches/sync.ts`) achatava tudo que não fosse `FINISHED`/`AWARDED` em `'scheduled'`, porque o CHECK de `matches.status` (migration 0001) só admite `('scheduled','live','finished')`. `POSTPONED`, `SUSPENDED` e `CANCELLED` viravam "agendado".
2. Ao adiar sem data nova, a football-data **zera o `utcDate`** para um placeholder de meia-noite (os 4 jogos passaram a reportar `2026-07-29T00:00:00Z`). O upsert gravava esse valor.

Resultado: jogo "agendado" num horário que já passou. Como `locked` é derivado em runtime de `start_time <= now` (ADR-004), o palpite travava permanentemente — e travava *mais cedo* que o horário original, tirando janela de edição de quem ainda não tinha palpitado. O jogo nunca virava `finished`, nunca pontuava, e o card mostrava "aguardando resultado" para sempre. O poller (ADR-007) não resgata: sua janela é `now-200min … now-115min`, passa uma vez e nunca mais olha.

### Decision

Coluna dedicada `matches.postponed INTEGER NOT NULL DEFAULT 0` (migration 0013), **não** um novo valor em `status`.

Alterar o CHECK exigiria rebuild da tabela, e `predictions.match_id REFERENCES matches(id) ON DELETE CASCADE` — o `DROP TABLE` intermediário do rebuild apagaria todos os palpites de produção. Flag separada resolve com um `ALTER TABLE`, sem tocar no schema existente.

Três consequências no comportamento:

1. **`start_time` não é sobrescrito enquanto `postponed = 1`.** O upsert usa `CASE WHEN excluded.postponed = 1 THEN matches.start_time ELSE excluded.start_time END`. Preserva o horário conhecido até o provider tirar o POSTPONED com data real. Sem heurística de "parece placeholder": `00:00Z` é kickoff legítimo no Brasileirão (21h BRT), detectar pelo horário daria falso positivo.
2. **Jogo adiado não trava o palpite.** Regra centralizada em `api/src/matches/locking.ts` (`lockedSql()` para SQL, `isMatchLocked()` para TS): travado = começou **e** não adiado. A versão TS compara `postponed !== 1` (fail-closed) — coluna ausente/nula volta ao lock normal por horário.
3. **A mesma condição governa a revelação anti-cópia.** Se um jogo adiado revelasse os palpites alheios enquanto ainda aceita edição, daria para copiar. Por isso `lockedSql()` é usado tanto no campo `locked` quanto nos `WHERE` de `GET /predictions/user` e `GET /predictions/group`.

### Consequences

- `needsSync` em `GET /matches` passou a filtrar `postponed = 0`. Sem isso um jogo adiado (start_time no passado, nunca `finished`) deixaria a flag verdadeira para sempre e **todo** GET dispararia sync em background, queimando a quota da football-data indefinidamente.
- O front recebe `postponed` no payload de `/matches` e espelha a regra em `useMatchCard` — o lock client-side por data também precisava da exceção.
- UI: badge "adiado" e data trocada por "data a definir", separados do badge "bloqueado" (que agora significa só "já começou").
- Corrige a premissa errada registrada em `docs/bolao-migration/README.md` ("3 jogos POSTPONED viram `scheduled` — ok, poller resolve").
- Migration 0013 precisa ser aplicada **antes** do deploy da API (as queries selecionam `m.postponed`).
- Jogo remarcado volta sozinho: o provider troca `POSTPONED` por `TIMED`/`SCHEDULED` com a data nova, o sync diário zera a flag e o `start_time` volta a ser atualizado.
- **`default_round` não muda.** A query pega a primeira rodada com `MAX(start_time) > now`; como o adiado guarda o horário original (passado), a rodada 21 continua fora e o default segue na 22 — correto, já que 6 dos 10 jogos dela foram disputados. Isso cria um buraco de descoberta: o palpite reaberto fica numa rodada que o usuário não tem motivo para visitar. Resolvido com um marcador no seletor de rodadas (`Rodada 21 · 4 adiados`) e um aviso com atalho "Ver rodada" no `PredictionsTab`, ambos sumindo sozinhos quando a flag zera. O aviso mostra **uma** rodada — a adiada mais próxima *antes* da aberta — e não aparece quando a rodada aberta já tem adiado. Sem essas duas regras o Brasileirão encadeia: ele acumula adiados distantes (a rodada 4 tem um Flamengo×Mirassol parado desde fevereiro), então avisar do mais antigo primeiro jogava o usuário 17 rodadas pra trás, e de lá um novo aviso apontava para a 21. O seletor continua marcando todas. Forçar o default na rodada adiada foi descartado: abriria numa tela majoritariamente encerrada enquanto a ação real do usuário é a rodada seguinte.
- Quando os jogos forem remarcados, o `ORDER BY MAX(start_time) ASC` mantém o comportamento correto: a rodada 21 só volta a ser default quando aqueles jogos forem de fato o próximo compromisso do calendário.

---

## ADR-014: Competition Radar — API-Football para oferta, Wikipedia Pageviews para demanda

**Status:** Accepted
**Date:** 2026-08-18

### Context

Decidir quais campeonatos incorporar ao Palpitae era palpite. Duas perguntas ficavam sem resposta: *o que está acontecendo agora* e *o que o público brasileiro acompanha*.

O provider do produto não responde a primeira. O plano grátis da football-data.org cobre 12 competições (as ligas europeias grandes, Brasileirão Série A, UCL, Copa do Mundo, Euro). Libertadores, Sul-Americana, Copa do Brasil e estaduais **não existem** nele — ou seja, não dava nem para perguntar "vale a pena entrar na Libertadores?", porque a competição era invisível para o sistema.

A segunda pergunta parecia ser trabalho do Google Trends. Não é, na prática: o `pytrends` foi arquivado em abril/2025, a API oficial anunciada em julho/2025 é alpha fechada por aplicação, e o resto do mercado (SerpApi, Glimpse, ScrapingBee) é pago. Nenhuma opção estável e grátis.

### Decision

Três fontes, uma tabela de snapshot diário (`competition_radar` + `competition_radar_daily`, migration 0014), consumidas por `/admin/oportunidades`:

1. **Oferta — API-Football (api-sports.io), plano grátis.** ~1.200 ligas contra as 12 do football-data. Duas chamadas por dia, das 100 da quota: `/leagues?current=true` (catálogo do mundo inteiro) e `/fixtures?date=hoje` (jogos do dia, agregados por liga aqui). Nenhuma consulta é por liga — isso estouraria a quota na primeira execução.
2. **Demanda — Wikimedia Pageviews API (pt.wikipedia).** Grátis, oficial, sem chave, série diária desde 2015. pt.wikipedia ≈ audiência brasileira, o que torna os números comparáveis entre competições. Uma chamada por competição curada (~40), a API não tem quota.
3. **Demanda interna — D1.** Grupos ativos por competição já suportada, cruzados por prefixo de `slug`.

**A API-Football não toca no produto.** Os jogos que alimentam palpites continuam vindo do football-data (ADR-007, ADR-010). O radar é ferramenta de decisão, não fonte de verdade — trocar o provider do produto é uma decisão separada, que este radar existe justamente para informar.

### Consequences

- Novo cron `0 7 * * *` (`radar/sync.ts`), isolado dos demais. Falha nele não afeta nada do produto: a dashboard mostra o último snapshot e avisa quando ele está velho (>30h).
- A curadoria de artigos (`api/src/radar/articles.ts`) é manual e é o gargalo do sinal de interesse. Competição sem artigo aparece na dashboard numa seção própria, como fila de trabalho — o sistema mostra o que não sabe medir em vez de esconder.
- Artigos são gravados pelo **título canônico**, não pelo redirect: um redirect tem pageviews próprios quase zerados ("Campeonato Brasileiro de Futebol - Série A" marca ~20/dia; o destino real, ~880/dia). Errar isso faria a competição parecer irrelevante.
- Usamos o artigo genérico da competição, não o da edição do ano. O da edição pega picos maiores, mas exige manutenção anual e às vezes nem existe a tempo (não havia artigo para o Brasileirão 2026 em agosto de 2026).
- A liga é casada por `(país, nome)` normalizado, não por id numérico do provider. Ids não são documentados publicamente e não dava para verificá-los sem consumir quota; nome e país são legíveis e conferíveis na própria tela.
- Guardamos só ligas de um recorte de países (Brasil, América do Sul, ligas europeias grandes, EUA/México/Arábia) mais as explicitamente curadas. Sem esse filtro seriam ~1.200 linhas/dia de ruído.
- O modelo já nasce com coluna `sport`: incluir NBA/NFL/F1 depois é trocar de provider, não migrar schema.
- Requer o secret `API_FOOTBALL_KEY`. Sem ele o cron vira no-op registrado (`radar_sync_run` com status `misconfig`) — nada quebra.
