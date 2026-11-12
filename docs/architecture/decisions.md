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

**Status:** Accepted, com o gatilho e a idempotência substituídos pela ADR-020
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
- ~~**Known limitation:** nothing currently promotes a competition's `status` to `'finished'`, so `status != 'finished'` never narrows.~~ Resolvida na atualização abaixo.
- `POST /matches/sync` (ADR predecessor, manual) is kept as an admin escape hatch.

### Atualização — 2026-11-12

Depois de sincronizar uma competição sem erro, a descoberta grava `competitions.status` pelos jogos (`reconcileCompetitionStatus`, em `api/src/matches/competitionLifecycle.ts`). 'upcoming' vira 'ongoing' quando um jogo começa. A competição vira 'finished' quando nenhum jogo gravado está pendente, há sinal de fim e o último jogo começou há mais de 7 dias. O status só avança: correção posterior não reabre a competição, e a visibilidade não muda. Falha do D1 ao gravar o status vira `competition_status_error`, separada de `football_api_error`.

O sinal de fim depende do provedor, porque os jogos gravados podem não cobrir o calendário (`finishedByMatchesSql`, em `api/src/groups/competitionStatus.ts`):

- Copa: jogo de fase de título que não seja ida. Final em ida e volta com só a ida gravada não encerra. A gravação também exige zero descartes `tbd` no sync, como na liga. A lista de fases de título (`TITLE_FINAL_PHASES`) precisa de revisão antes de entrar um estadual: competição encerrada por engano não volta sozinha.
- Liga da football-data: a descoberta pede o calendário inteiro, mas o sync descarta jogo sem os dois times definidos (`missing_competitor`/`tbd`). A liga encerra quando não tem jogo gravado pendente e o sync daquela execução não descartou nenhum jogo `tbd`. Exemplo: a final da Championship fica dias no calendário sem os times depois das semifinais. Os outros descartes não contam, porque uma fase desconhecida da ESPN se repete em toda execução e prenderia a competição na descoberta.
- Liga da ESPN: a descoberta só enxerga até hoje + 7 dias, então a liga só acaba com 60 dias sem jogo novo. Data FIFA e pausa de Copa do Mundo não encerram a liga.

A tela usa a mesma regra sem os 7 dias de confirmação e sem a contagem de descartes. Nesses dias a competição já aparece encerrada e a descoberta continua buscando o calendário: é a janela de correções de placar e da volta de uma final que ainda não estava no horizonte da ESPN. Depois disso a competição sai da descoberta. O poller não olha o status da competição e continua cobrindo os jogos gravados; `POST /matches/sync` segue como saída manual.

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

**Status:** Accepted, com o trecho sobre `default_round` substituído pela ADR-019
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

**Status:** Accepted, com a fonte de oferta e o rate limit por IP substituídos pela ADR-015
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

- **A coleta NÃO roda no Worker.** A API-Football aplica rate limit **por IP**, e os IPs de saída dos Cloudflare Workers são compartilhados por milhares de clientes: do Worker a primeira chamada do dia volta `429 {"rateLimit":"Too many requests"}` com a quota da conta intacta (2/100 no dia), enquanto do IP de um runner do GitHub a mesma chamada devolve `200` com 1.232 ligas. Descoberto ao popular produção, não em teste local — localmente tudo passava porque o `wrangler dev` sem `--remote` sai pelo IP da máquina.
- Por isso a coleta é um **GitHub Actions diário** (`.github/workflows/radar-sync.yml`, 07:00 UTC + `workflow_dispatch`). O mesmo `syncRadar` roda sem alteração: `SqlCollector` implementa a fatia da interface do D1 que ele usa e serializa os statements num `.sql`, aplicado com `wrangler d1 execute --remote --file`. Um `INSERT` por linha via REST API seriam ~1.500 requisições; o arquivo é uma chamada.
- Separação de credenciais como consequência bem-vinda: o script só recebe `API_FOOTBALL_KEY`, e quem escreve no D1 é o wrangler com o token que o CI já usa. A chave da API-Football nunca toca no Cloudflare; o token do Cloudflare nunca toca na API-Football.
- Falha na coleta não afeta nada do produto: a dashboard mostra o último snapshot e avisa quando ele está velho (>30h). O script sai com erro se não gerar nenhum statement — o workflow fica vermelho em vez de aplicar um arquivo vazio.
- A curadoria de artigos (`api/src/radar/articles.ts`) é manual e é o gargalo do sinal de interesse. Competição sem artigo aparece na dashboard numa seção própria, como fila de trabalho — o sistema mostra o que não sabe medir em vez de esconder.
- Artigos são gravados pelo **título canônico**, não pelo redirect: um redirect tem pageviews próprios quase zerados ("Campeonato Brasileiro de Futebol - Série A" marca ~20/dia; o destino real, ~880/dia). Errar isso faria a competição parecer irrelevante.
- Usamos o artigo genérico da competição, não o da edição do ano. O da edição pega picos maiores, mas exige manutenção anual e às vezes nem existe a tempo (não havia artigo para o Brasileirão 2026 em agosto de 2026).
- A liga é casada por `(país, nome)` normalizado, não por id numérico do provider. Ids não são documentados publicamente e não dava para verificá-los sem consumir quota; nome e país são legíveis e conferíveis na própria tela.
- Guardamos só ligas de um recorte de países (Brasil, América do Sul, ligas europeias grandes, EUA/México/Arábia) mais as explicitamente curadas. Sem esse filtro seriam ~1.200 linhas/dia de ruído.
- O modelo já nasce com coluna `sport`: incluir NBA/NFL/F1 depois é trocar de provider, não migrar schema.
- `ends_on` do provider é um **piso**, não a data real de fim: em mata-mata ele só conhece as datas dos confrontos já definidos (mesmo fenômeno do ADR-010). Validado em produção — a Libertadores 2026, em plena fase final, reportava `ends_on` na data do jogo seguinte. Por isso `finished` exige janela vencida **e** nenhum jogo nos últimos 14 dias; na dúvida a competição fica `ongoing`.
- Requer o secret `API_FOOTBALL_KEY` **no GitHub** (não no Worker). Sem ele o script sai com erro e o workflow falha, sem tocar no D1.

---

## ADR-015: Radar Provider — ESPN em lugar da API-Football


**Status:** Accepted
**Date:** 2026-10-05

### Context

A conta da API-Football foi **suspensa em 04/09/2026**, sem causa informada. O uso era exatamente o projetado na ADR-014: 2 requisições/dia das 100 da quota (catálogo + jogos do dia), nada além. Hipótese — nunca confirmada pelo suporte: os IPs rotativos dos runners do GitHub Actions, compartilhados com outros clientes da mesma API, podem ter tocado algum bloqueio de abuso. Não havia perspectiva de reação e decidimos não pagar plano nem esperar suporte: o radar é inteligência de produto, não componente do produto.

O que o substituto precisava manter: cobertura das competições que o provider do produto não enxerga (Libertadores, Sul-Americana, Copa do Brasil, estaduais), temporada corrente, jogos do dia, custo zero. Testado ao vivo em 05/10/2026: a **API pública da ESPN** (`site.api.espn.com`) responde 200 sem autenticação, sem quota conhecida e estável há anos — não é uma API documentada/oficial, é a que alimenta o próprio site da ESPN.

### Decision

Trocar a **fonte de oferta** do radar para a ESPN (`api/src/providers/espn.ts` + `api/src/radar/espnRadar.ts`). Demanda (Wikipedia Pageviews), demanda interna (D1), snapshot fail-closed e o modelo "script gera SQL + wrangler aplica" da ADR-014 ficam como estão.

- O padrão de coleta muda de **"2 chamadas que trazem o mundo"** (`/leagues?current=true` + `/fixtures?date=`) para **"~35 chamadas de slugs curados"**: uma de scoreboard por competição do recorte, lista estática (`ESPN_LEAGUES`), concorrência limitada. A ESPN não tem catálogo utilizável em runtime.
- **A temporada vem na própria resposta** do scoreboard (`leagues[0].season`): não existe mais chamada de catálogo. Liga sem `season`, ou com season fora da janela — a ESPN deixa a última edição no payload, ex. Euro 2024 e Copa América 2024 em pleno 2026 —, é pulada como "não corrente" (o equivalente do `current=true` antigo).
- **`matches_today` é contado filtrando os `events` pelo campo `date`**: o parâmetro `date` do scoreboard NÃO filtra estritamente — para uma data sem jogos devolve a rodada vizinha e, fora de temporada, os últimos jogos. `events.length` sozinho contaria jogos que não são do dia (descoberto comparando payloads reais).
- Nomes e países das ligas são **escolhidos na curadoria**, não copiados da ESPN (que chama bra.1 de "Brazilian Serie A" e esp.1 de "Spanish La Liga"): o casamento com os artigos da Wikipédia continua por `(país, nome)` normalizado.
- O refresh da lista curada é **manual/mensal**, conferindo o catálogo completo de slugs (~219, espelhado em `api/src/radar/__fixtures__/espn-catalog.json`):

```bash
for p in $(seq 1 9); do
  curl -s "https://sports.core.api.espn.com/v2/sports/soccer/leagues?limit=2000&page=$p" |
    python3 -c 'import json,sys; [print(r["$ref"].rsplit("/",1)[1].split("?")[0]) for r in json.load(sys.stdin).get("items",[])]'
done | sort -u
```

- O sync purga as linhas do provedor antigo no início de todo snapshot (idempotente): `DELETE FROM competition_radar WHERE provider = 'api-football'` + `DELETE FROM competition_radar_daily WHERE radar_id LIKE 'api-football:%'`.

### Consequences

- **Lacunas aceitas** — não existem na ESPN: Série C, Campeonato Baiano, Pernambucano, Paranaense, Copa do Nordeste e Brasileirão Feminino. As entradas de artigo dessas competições em `articles.ts` ficam sem sinal de oferta (e sem pageviews, que só rodam para o que está no snapshot) até a ESPN cobrir ou outro provider entrar.
- **Risco de API não-oficial** (sem SLA, pode mudar sem aviso) mitigado pelo desenho fail-closed: coleta que falha ou volta vazia preserva o snapshot do dia anterior e deixa o workflow vermelho; a dashboard avisa quando o snapshot passa de 30h.
- **Sem chave → sem secret**: `API_FOOTBALL_KEY` sai do workflow e pode ser removido do repositório no GitHub. A coleta continua no Actions **por escolha de arquitetura** (SQL + wrangler, credenciais separadas — ver ADR-014), não por rate limit: a ESPN não tem chave nem política por IP.
- Custo por execução: ~35 chamadas à ESPN + ~1 chamada à Wikimedia por competição mapeada (~26). Nenhuma quota conhecida dos dois lados.
- Falha parcial de slugs é tolerada (o snapshot segue com os que responderam, os falhos vão no log); todos em erro aborta a coleta.
- A ADR-014 permanece válida exceto na fonte de oferta e na consequência do rate limit por IP, que esta supersede.

---

## ADR-016: Results Failover — ESPN como reserva do football-data.org


**Status:** Accepted
**Date:** 2026-10-05

### Context

O poller de resultados (ADR-007) só pontua um jogo depois que o `syncFixtures` da football-data.org grava o placar no D1. Se a API cai (429/5xx/outage) exatamente na janela de 115–200 min após o kickoff, o jogo fica sem placar até o provedor voltar — e a janela do poller passa uma vez só: quando o primário volta, o jogo saiu da janela e nunca mais é pontuado pelo caminho normal.

O plano B testado ao vivo em 05/10/2026 é o scoreboard não-oficial da ESPN: `GET https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard` responde 200 sem autenticação e sem quota conhecida. A conta da API-Football (usada só pelo radar, ADR-014) foi suspensa sem causa em 04/set — o requisito do operador é ter plano B gratuito para o produto também.

### Decision

**O fallback é só de RESULTADOS.** Quando o `syncFixtures` de uma competição falha no poller, `api/src/matches/espnFallback.ts` (`scoreWindowFromEspn`) consulta os jogos daquela competição na mesma janela ativa do poller (`status != 'finished'`, start+115..200 min), busca o scoreboard da ESPN e, para cada jogo interno que casa com um evento encerrado (`status.type.state = 'post'` com `completed = true`, fora dos status de adiamento e cancelamento), grava `home_score`, `away_score` e `status = 'finished'` com `UPDATE ... WHERE id = ? AND status != 'finished'`. Competição onde o fallback atualizou ≥1 jogo entra no `syncedComps` e segue para o `scoreUnprocessedMatches` como se o sync tivesse funcionado. `scored_at` fica NULL de propósito — a pontuação acontece na sequência, pelo mecanismo existente.

**A descoberta de jogos permanece exclusiva do football-data.org** (ADR-010). O fallback NUNCA insere jogos, times ou competições — só `UPDATE` em linhas existentes. Sem essa restrição, um provedor de reserva com ids e nomes diferentes criaria entidades duplicadas (`UNIQUE (external_id, provider)` não protegeria contra ids de outro provider) e jogos "gêmeos" quebrariam palpites e grupos.

Casamento jogo↔evento: nomes dos times normalizados (NFD, sem diacritics, lowercase, sem pontuação — o padrão do `matchKey` do radar), com conter/contido nos dois sentidos (football-data usa 'Liverpool FC', a ESPN 'Liverpool'), exigido em mandante E visitante, mais kickoff a até ±150 min. Toda dúvida é **fail-closed**: 0 ou >1 candidatos, evento sem fim de jogo confirmado, placar não-numérico → pula o jogo. Errar por não pontuar é recuperável (o primário volta e o sync diário/ADR-013 cobre remarcações); pontuar errado não é.

Os clubes do Brasileirão são gravados com o nome popular, escolhido pelo `external_id` da football-data em `api/src/matches/clubNames.ts`. O nome popular segue o da ESPN e casa pelo mesmo critério.

Mapeamento de competições em `FOOTBALL_DATA_TO_ESPN` (código football-data → slug ESPN), conferido ao vivo em `api.football-data.org/v4/competitions`: Europa League é **`EL`** → `uefa.europa` (o código `ECL` dos rascunhos não existe; Conference League é `UCL`, TIER_FOUR, fora do free tier e sem uso no produto). `EC` (Eurocopa, TIER_ONE) entrou como `uefa.euro`. Código sem mapeamento → log info e fallback não se aplica — não é erro.

Dois detalhes da ESPN validados ao vivo que moldaram a implementação:

- O parâmetro de data é **`dates=YYYYMMDD` (plural)**. O singular `date=` é silenciosamente ignorado e devolve a rodada corrente — todos os eventos em 'pre', ou seja, um fallback que nunca atualiza nada.
- O scoreboard agrupa eventos por **dia norte-americano**: São Paulo×Cruzeiro `2026-10-08T00:30Z` aparece em `dates=20261007`. Por isso buscamos o dia UTC de cada jogo E o dia anterior (2 fetches por data distinta — cobre qualquer fronteira de fuso fixa).

### Atualização — 2026-10-26

O fallback também roda após um sync bem-sucedido que deixou jogos sem resultado. Consulta somente partidas ainda não finalizadas, de 115 minutos até 24 horas após o início, e exclui adiados fora da janela ativa de 200 minutos. Placares alterados limpam `scored_at` para refazer a pontuação. O sync primário preserva a linha de um jogo finalizado quando recebe um estado não final; correções de resultado final continuam permitidas.

### Consequences

- **Roda dentro do Worker pelo cliente ESPN compartilhado.** A consulta ao D1 evita requests para competições sem pendentes. As chamadas HTTP compartilham timeout, pacing anti-403 e retry limitado com os demais consumidores da ESPN; a janela de resgate pode consultar até três datas por competição.
- Falha do fallback NUNCA quebra o poller: try/catch no ponto de chamada e por competição dentro do módulo. O próximo run volta a tentar pelo caminho primário.
- **Observabilidade**: um evento `match_results_fallback` por competição (`blobs: [compId]`, `doubles: [atualizados, pulados]`) no Analytics Engine, além do `football_api_error` já emitido na falha do primário. O `poller_run` segue com status `error` quando o primário falhou — o fallback é melhor-esforço, não apaga o incidente.
- **Pênaltis ficam fora do escopo**: o fallback grava só placar e status; `penalty_winner` e gols de pênaltis permanecem como estavam. Quando o primário volta, o upsert do sync preenche os campos e zera `scored_at` (mecanismo já existente), disparando re-score com o bônus de pênaltis. Custo transitório: grupos de mata-mata podem ver os pontos do bônus chegarem depois.
- O fallback não conhece `postponed`. Quem barra o adiado é o status da ESPN. A premissa original, de que um adiado nunca chega em 'post', estava errada. Em 08/11/2026 Estoril × Marítimo veio como `STATUS_POSTPONED` com `state = 'post'`, `completed = false` e placar 0-0, e o fallback gravou um 0-0 final e pontuou. Com esta correção, o fallback e o sync primário da ADR-018 só encerram jogo com `completed = true` e nome fora de `ESPN_POSTPONED_STATUSES` (adiado, cancelado, suspenso e abandonado), pela função `isEspnFinal` de `api/src/providers/espn.ts`. O sync primário também deixa de travar adiado ou cancelado em 'post'. A tolerância de ±150 min continua rejeitando remarcações para outro dia, e o ADR-013 continua sendo a via de resgate desses jogos.
- Nomes de seleções são traduzidos no sync primário ('Brazil' → 'Brasil', `TEAM_TRANSLATIONS` em `sync.ts`) e a ESPN usa o nome em inglês ('Brazil') — o casamento por conter/contido não casa 'Brasil'×'Brazil'. Hoje isso só afetaria Copa do Mundo/Eurocopa; aceitável como limitação conhecida (fail-closed: o jogo só fica sem placar até o primário voltar).
- A ESPN não-oficial não tem SLA nem schema versionado; o código trata payload ausente/inesperado como não-casamento (fail-closed), não como erro.

## ADR-017: Controle de acesso e persistência de limites

### Contexto

Revelar palpites após o primeiro envio permite copiar os demais e editar antes
do início da partida. Remover apenas a participação permite reentrar com um
convite salvo. Sessões JWT copiadas também permanecem válidas após o logout.

### Decisão

Grupos ocultos revelam palpites alheios somente após o bloqueio da partida. O
próprio palpite segue editável até esse bloqueio. A remoção feita pelo dono revoga
a participação e a reentrada no grupo; a saída voluntária preserva a reentrada.
Grupos excluídos deixam de autorizar consultas e gravações.

O D1 guarda os bloqueios de membros, os hashes das sessões revogadas até sua
expiração e os contadores atômicos de requisições. Requisições com sessão válida
contam por usuário; as anônimas, por IP do visitante. Atrás do proxy do Pages, o
IP chega num header autenticado por `PROXY_SHARED_SECRET`, porque o
`CF-Connecting-IP` de um subrequest de Worker é o endereço de saída da Cloudflare.
Os crons limpam os contadores e revogações expirados. Leituras de partidas
consultam os dados locais; cron e sync administrativo atualizam os provedores
externos, e o poller resgata jogos sem resultado por até 24 horas.

### Consequências

A migração precisa preceder a publicação do Worker. Cada requisição fora de
`/health` faz uma escrita no D1 (contador) e, com cookie de sessão, uma leitura
em `revoked_sessions`. Leituras seguem sem contador se o D1 falhar; escritas e
OAuth respondem 503. Os limites e a política de acesso estão em
[Controle de acesso e limites da API](../security.md).

## ADR-018: ESPN como provider primário nas competições fora do free tier

**Status:** Accepted
**Date:** 2026-10-17

### Context

O produto jogável tem só Copa do Mundo 2026 e Brasileirão Série A 2026. As competições de maior interesse BR fora do produto — Libertadores, Copa do Brasil e Sul-Americana — estão no football-data.org apenas em planos pagos, e a regra do lote é usar só fontes grátis, sem upgrade de plano. A ESPN cobre as três de graça, mas a ADR-016 proíbe a ESPN de criar jogos: lá ela é só fallback de resultados, e a descoberta é exclusiva do football-data.org.

### Decision

Modelo multi-provider por competição, mantendo custo zero:

- football-data.org (free tier) segue primário onde cobre, ex.: Champions (`CL`) e Premier League (`PL`); nelas a ESPN continua só fallback de placar.
- A ESPN vira provider primário — descobre e cria times e jogos — só nas competições fora do free tier que entrarem no produto, a começar por Libertadores, Copa do Brasil e Sul-Americana.
- Campeonato sem fonte grátis validada não entra. Antes do cadastro, um spike precisa confirmar jogos, datas, fases, placares, vencedor de pênaltis e vínculo ida/volta no slug ESPN.
- Esta ADR supersede a ADR-016 apenas na frase "a descoberta de jogos permanece exclusiva do football-data.org". Todo o resto da ADR-016 (fallback fail-closed, casamento de jogos, observabilidade) segue válido para competições do football-data.

### Consequences

- A ESPN é API não oficial, sem SLA: competição ESPN-primária nasce com risco de mudança de formato, mitigado pelo spike de entrada e por testes de contrato com payload mockado.
- O discovery diário e o poller, hoje restritos a `provider='football-data'`, passam a incluir competições `provider='espn'`. O fallback ESPN precisa ignorar competições em que a ESPN já é primária, para não duplicar jogos.
- Estaduais seguem fora do roadmap mesmo com ESPN disponível: janela curta e decisão de produto, não limitação de fonte.
- Em 2026-10-19 o spike em `docs/architecture/spike-espn-serie-b.md` aprovou `bra.2` (fixture e teste de contrato). A liga pode entrar como ESPN-primária `type=league` no ticket 06 do lote 2, sem reabrir o spike de copas. No football-data, `BSB` é TIER_THREE. O sync já mapeia `2026-brasileiro-serie-b` para `REGULAR_SEASON` (#546). Sem `week`/`matchday` no scoreboard, a rodada do piloto fica `REGULAR_SEASON`.

## ADR-019: Rodada padrão ignora rodada antiga com jogo remarcado

**Status:** Accepted
**Date:** 2026-11-07

### Context

A rodada padrão (`default_round`) era a rodada com o menor `MAX(start_time)` ainda no futuro. A ADR-013 contava com isso para os adiados: o adiado guarda o horário original, a rodada sai do default, e "a rodada 21 só volta a ser default quando aqueles jogos forem de fato o próximo compromisso do calendário".

Remarcado é outro caso. Em 07/11/2026 a rodada 21 do Brasileirão tinha 9 jogos encerrados entre julho e outubro e Chapecoense × Vasco remarcado para 14/11, com `postponed = 0`. A rodada 35, toda futura, termina em 20/11. Como 14/11 vem antes de 20/11, o grupo abria na 21, uma tela quase toda encerrada, enquanto a ação do usuário era a 35. A mesma consulta estava copiada em `GET /matches`, `GET /predictions/user` e na contagem de pendentes da home.

### Decision

Uma rodada candidata (com jogo futuro) **fica para trás** quando a maioria dos jogos dela começou há mais de 7 dias (`start_time <= now - 7 dias`, só pelo horário). As candidatas são ordenadas por `ficou para trás` e depois por `MAX(start_time)`; a primeira é a rodada padrão. Se todas ficaram para trás, a ordem é só `MAX(start_time)`, como antes. No empate de `MAX(start_time)` vence a rodada que começou depois, e `round` fecha o desempate. A dica da aba Palpitar procura rodadas antes da aberta, então aponta a outra. Sem candidata, o default continua sendo a rodada do último jogo.

A definição está em `api/src/matches/defaultRound.ts`, compartilhada pelas três consultas. O front repete só o "ficou para trás" em `web/src/lib/rounds.ts`, para a dica, e recebe a rodada padrão pronta no `default_round`.

Os casos que mantêm o comportamento anterior:

- Rodada em andamento: tem jogos de ontem e de amanhã, nenhuma maioria antiga.
- Mata-mata de ida e volta numa rodada só, com uma semana de intervalo: a ida é metade dos jogos, e metade não é maioria.
- Fim de temporada sem jogo futuro: nenhuma candidata, cai no último jogo.
- Adiado sem data nova: guarda o horário passado (ADR-013), a rodada nem é candidata.

O travamento continua o da ADR-004 (`lockedSql`): a regra só escolhe qual rodada abre, não muda quem pode palpitar.

### Consequences

- O jogo remarcado aparece na aba Palpitar pela dica da ADR-013, agora para adiados e remarcados ("Rodada 21 tem 1 jogo remarcado. O palpite segue aberto. Ver rodada"), e o seletor marca a rodada ("Rodada 21 · 1 remarcado"). A rodada padrão nunca ganha esse marcador, mesmo quando também ficou para trás.
- A contagem de pendentes da home soma os jogos abertos da rodada padrão e os jogos futuros abertos das outras rodadas que ficaram para trás: o remarcado tem prazo e a home é o único lugar que avisa dele antes de o usuário abrir o grupo. Adiado sem data nova de rodada antiga continua fora da contagem. A contagem sai de uma varredura só do índice coberto da competição, que numera as candidatas e já traz a rodada padrão e as que ficaram para trás. Os jogos de cada uma vêm de `idx_matches_comp_round_start` com a rodada já resolvida. O `GET /groups` continua lendo o índice da competição uma vez por grupo.
- Risco aceito: uma fase longa numa rodada só (`GROUP_STAGE`, `TACA_GUANABARA`, `REGULAR_SEASON`) também fica para trás depois de algumas semanas. Enquanto ela for a única candidata, a ordem só por `MAX(start_time)` a mantém como padrão; se outra fase já tiver jogos cadastrados enquanto ela ainda corre, o default pula para a outra. Hoje o sync só grava jogo de mata-mata com os times definidos. Em competição com sorteio entre fases, a seguinte só aparece depois que a anterior acaba. Em chave fixa, um jogo pode aparecer antes.
- Risco aceito: uma rodada dividida, como 7 jogos no sábado e 3 remarcados para 11 dias depois, perde o default 7 dias depois do sábado. Os remarcados vão para a dica mesmo sendo o próximo jogo do calendário.
- Substitui a frase da ADR-013 sobre a rodada remarcada voltar a ser default quando seus jogos forem o próximo compromisso.

## ADR-020: Lembrete diário por jogo sem palpite

**Status:** Accepted
**Date:** 2026-11-08

### Context

O e-mail de lembrete saía às 07h do primeiro dia da rodada, só para quem não tinha nenhum palpite na rodada. A rodada 35 do Brasileirão tem 1 jogo em 14/11 e 9 em 18 e 19/11. Quem palpitasse o primeiro não recebia aviso dos outros 9. Um cron por dia e o filtro do primeiro dia da rodada eram a proteção contra repetição.

### Decision

O cron das 07h BRT agora envia, a cada usuário, um e-mail com os jogos de hoje ainda abertos e sem palpite, agrupados por grupo e rodada. Jogo adiado (`postponed = 1`) não entra, porque não tem data. Jogo remarcado (`postponed = 0` e horário novo) entra no dia novo, mesmo em rodada que ficou para trás (ADR-019), e o link usa a rodada dele. O link leva `?rodada=` e abre a aba Palpitar nessa rodada.

O limite de um e-mail por usuário por dia fica no banco, na tabela `email_reminder_sends` (`PRIMARY KEY (user_id, reminder_date)`, migration 0036). O cron reserva todos os destinatários em uma gravação antes do primeiro envio e só envia para quem a reserva devolveu. Falha de envio devolve a reserva. Reenvio dentro de `sendWithRetry` e reexecução no mesmo dia usam o mesmo `Idempotency-Key` do Resend.

A reserva é uma gravação só por execução porque cada consulta ao D1 conta no limite de subrequests do Worker junto com os envios ao Resend.

O plano da conta Cloudflare não está confirmado (`docs/architecture/capacidade-coordenacao-provedores.md`, item 8), então vale o pior caso: Free, com 50 subrequests por invocação. A execução gasta 4 consultas fixas (SELECT, batch de reserva, liberação das reservas e a limpeza de segurança do `scheduled`) e deixa 1 de folga, o que dá um teto de 45 `fetch` ao Resend, reenvios incluídos. Cada tentativa de `sendWithRetry` desconta do saldo. Com o saldo zerado, a fila encerra antes de chamar a rede, cada destinatário restante registra `email_reminder_failed` com `reason = subrequest_budget` e as reservas dele são devolvidas, como na cota esgotada. Quem ficou sem e-mail entra na próxima execução do mesmo dia, se houver, e a reserva impede repetir para quem já recebeu. O teto vem da variável `REMINDER_FETCH_BUDGET` do Worker, com 45 como padrão. Valor que não seja inteiro positivo volta ao padrão e registra erro no log. Acima de 45 só cabe com o plano Paid confirmado.

Quando o teto não cobre todos, a fila de envio começa por quem recebeu o lembrete há mais tempo, pelo dia mais recente em `email_reminder_sends`. Quem ficou de fora num dia não tem linha desse dia e passa à frente, no dia seguinte, de quem recebeu. No empate vale o jogo que fecha primeiro. Antes a fila seguia só o horário do primeiro jogo, e quem tinha jogo apenas à noite ficava de fora todos os dias.

O dia do lembrete e a meia-noite que fecha a lista saem do fuso `America/Sao_Paulo` pela base do `Intl`. Antes vinham de um deslocamento fixo de 3 horas. Se o horário de verão voltar, o jogo de 00:30 do dia seguinte continua fora da lista.

Grupo de competição em piloto só entra no e-mail de quem tem acesso ao piloto (`ADMIN_EMAIL` ou `PILOT_EMAILS`), o mesmo critério da lista de grupos.

O descadastro é conferido de novo durante o envio. A gravação da reserva só reserva quem ainda está inscrito, então quem saiu entre a consulta dos pendentes e a reserva fica de fora. Essa leitura vale por 5 segundos (`UNSUB_RECHECK_MS`). Uma tentativa de envio, inclusive um reenvio, que comece depois desse prazo relê numa consulta só a preferência de todos os destinatários que faltam, e a consulta desconta um subrequest do mesmo saldo de 45. Um lote cheio dura mais de 5 segundos, porque os envios saem um por vez, e gasta de 1 a 3 vagas do teto nessas consultas. Ler antes de cada envio cortaria pela metade quem cabe no teto. Quem descadastrou não recebe, não conta como falha e tem a reserva devolvida. Se a consulta falhar, a fila encerra e os restantes registram `email_reminder_failed` com `reason = unsub_check_failed`.

O ponto sem volta é o início do `fetch` ao Resend. Descadastro depois disso não desfaz o e-mail aceito. Um reenvio cancelado por descadastro depois de 5xx ou erro de rede pode ter sido precedido de um aceite que a resposta não confirmou.

### Consequences

- Risco aceito: uma invocação interrompida entre a reserva e o envio deixa os restantes sem e-mail naquele dia. Perder um aviso é preferível a repetir o e-mail.
- Quem nunca palpita recebe um e-mail por dia com jogo, em vez de um por rodada. O volume sobe e consome a cota do Resend. Cota esgotada encerra a fila e registra `email_reminder_failed` com `reason = quota_exceeded`.
- Risco aceito: com o teto de 45 `fetch`, uma base com mais de 45 destinatários no dia deixa o excedente sem e-mail enquanto houver uma execução diária só. A fila por último envio reveza o excedente entre os dias. Se o excedente passar do teto, alguém fica de fora dois dias seguidos, sempre quem recebeu mais recentemente.
- O revezamento olha os 7 dias guardados em `email_reminder_sends`. Quem não recebeu nesse período é tratado como quem nunca recebeu.
- `email_reminder_sent` deixa de ter campeonato e rodada, porque um e-mail reúne vários. O evento traz o dia e o número de jogos listados.

## ADR-021: Ranking com pontos e variação da última rodada encerrada

**Status:** Accepted
**Date:** 2026-11-08

### Context

A aba Ranking mostrava posição, jogador, pontos e exatos. O grupo não via quanto cada membro fez na última rodada nem quem subiu ou caiu. Guardar uma foto do ranking por rodada daria números errados, porque os pontos em `predictions` são regravados quando um bônus muda (`classifiedRuleChangeStatements`) ou quando a pontuação é refeita.

### Decision

`GET /groups/:id/round-standings` calcula o resultado na hora, sem tabela nova nem migration, em `api/src/groups/roundStandings.ts`. A autenticação e o gate são os de `GET /groups/:id/members`.

A rodada de referência do grupo sai só dos `matches` da competição do grupo:

1. Só rodada numerada, com `round` só de dígitos, o mesmo critério de `isGroupStageRound` em `web/src/lib/rounds.ts`.
2. A rodada está encerrada quando tem ao menos 1 jogo `finished` com `scored_at` preenchido e nenhum jogo pendente. Pendente é `(status != 'finished' AND postponed = 0) OR (status = 'finished' AND scored_at IS NULL)`. Jogo encerrado ainda sem pontuação mantém a rodada aberta mesmo com `postponed = 1`, porque os palpites dele ainda não têm pontos e a football-data grava `SUSPENDED` com essa flag. Adiado sem data e não encerrado (`postponed = 1`) não impede. Jogo remarcado para o futuro (`postponed = 0`) mantém a rodada aberta. É a mesma ideia de `roundScope` em `web/src/lib/roundSummary.ts`.
3. Entre as encerradas, vale a de maior número (`CAST(round AS INTEGER)`), nunca a de jogo mais recente. Um jogo remarcado da rodada 21 que acaba depois da rodada 34 não troca a referência.
4. Se alguma fase eliminatória (`isKnockoutPhase` sobre a coluna `phase`) tem jogo pontuado com `start_time` posterior ao início da rodada de referência, o mata-mata começou e a resposta é `{ "round": null, "standings": [] }`. Só uma referência é calculada, sem tentar uma rodada menor. O início da rodada é o menor `start_time` dos jogos dela. Jogo eliminatório encerrado e ainda sem `scored_at` não bloqueia. Fase não eliminatória nunca bloqueia, seja qual for o `round`.

O mata-mata fica fora desta coluna e de `roundScope`. Uma fase sem número não tem a rodada numerada que serve de referência.

`round_points` usa a mesma soma do leaderboard (`points_awarded + penalty_points + classified_points`) e os exatos usam o mesmo `CASE`. Os dois fragmentos SQL saem de `api/src/matches/scoring.ts`, para as contas não divergirem. Membro sem palpite na rodada tem `round_points` 0. Só contam os membros atuais em `group_members` que não estão em `group_bans`.

A posição atual segue a ordem oficial, `total_points DESC, exact_hits DESC, joined_at ASC`, com `user_id ASC` como último desempate, também em `GET /groups/:id/members`, para a ordem ser determinística. Quem não tem linha no `leaderboard` entra com 0 ponto e 0 exato. A regra de empate total e o que acontece ao sair e voltar estão em `docs/group-scoring.md`. A posição anterior aplica a mesma ordem a `total_points - since_points` e `exact_hits - since_exact`. `since_points` e `since_exact` somam a rodada de referência e as rodadas numeradas posteriores, porque o `leaderboard` já inclui os jogos pontuados da rodada em andamento e descontar só a referência compararia com um estado que nunca existiu. A posição atual continua sendo a do ranking oficial, com esses jogos. Jogo remarcado de rodada numerada anterior conta como ponto de antes. `position_change` é a posição anterior menos a atual, e positivo é subiu. Quando todos os totais anteriores são 0, `position_change` é `null` para todos, porque a variação não diria nada.

Na web, `LeaderboardTab` carrega membros e `round-standings` em paralelo e só desenha a tabela quando as duas respostas terminam. Falha em `round-standings` não é erro de tela, e a tabela aparece como antes, sem a coluna e sem setas. Com `round` preenchido entram a coluna da rodada entre Jogador e Pontos, a variação sob o número da posição e, se alguma posição tiver mudado, um aviso do que as setas comparam.

A API devolve `streak` em cada linha, com as rodadas encerradas seguidas em que o membro palpitou todos os jogos pontuados, contadas da referência para trás. Só contam as rodadas encerradas pelo critério acima. Rodada numerada aberta é pulada sem quebrar a sequência, e jogo adiado sem data não é exigido. A web calcula o rei da rodada. São os membros com o maior `round_points`, se for maior que 0, e empate coroa todos. Os dois saem dos palpites e dos jogos a cada leitura, sem tabela nem backfill, e por isso valem para rodadas passadas e acompanham a pontuação refeita. Nenhum deles dá ponto no ranking.

### Consequences

- Champions e Copa do Mundo perdem a coluna quando o mata-mata começa. Copa do Brasil e Libertadores nunca têm a coluna, porque as fases delas vêm sem número. Competição com `round` por fase, como `REGULAR_SEASON`, também fica sem coluna.
- Jogo adiado que recebe data nova reabre a rodada. Enquanto ele não acaba, a referência cai para a encerrada de maior número, e a coluna pode voltar a uma rodada anterior.
- Cada abertura da aba recalcula a referência varrendo os jogos da competição e soma os palpites do grupo da rodada em diante. Não há cache, e o custo cresce com o número de jogos e de palpites do grupo.
- A variação compara a ordem antes e depois da rodada de referência. Um jogo remarcado de rodada antiga que pontua depois entra no total e na posição anterior como se sempre estivesse lá, sem aparecer como movimento.
- Caso aceito: uma fase preliminar eliminatória adiada que termine depois do início da rodada de referência tira a coluna até uma rodada posterior fechar.
- Risco aceito: uma leitura entre a gravação dos pontos e a atualização do `leaderboard` pode mostrar variação errada por alguns segundos. A próxima abertura da aba corrige.
