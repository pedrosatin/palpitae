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
- **Sender:** `naoresponda@palpitae.com.br`.
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
