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

- Create with: `npx wrangler d1 migrations create palpitae <description> --config ./wrangler.toml` (from `api/`; always with `--config`, so a `wrangler.json(c)` in a parent directory cannot win)
- **Never edit an already-applied migration** — create a new one instead
- Every schema change, index addition, or data backfill requires a new migration file
- Migrations run before the Worker is published, so each one must keep the previous Worker working (expand/contract, see [docs/operations/migrations.md](../operations/migrations.md)). Dropping or renaming a column, table or view needs a `-- contract: <reason>` line; `api/src/migrationCompat.test.ts` enforces it

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
- A conferência em TypeScript em `isMatchLocked` responde rápido antes da escrita, e o comando SQL decide a gravação. `PUT /predictions`, `PUT /predictions/bulk`, `POST /predictions/import` e `POST /predictions/replicate` gravam com `INSERT … SELECT … WHERE NOT lockedSql('m', SQL_NOW)` pela função `prepareGuardedUpsert` em `api/src/predictions/guardedUpsert.ts`, então o jogo é relido com o relógio do banco no instante da escrita. Se o kickoff passou entre a leitura do handler e a gravação, a instrução altera zero linhas e não deixa palpite. O `PUT` único responde 422 e o `bulk` move o jogo de `saved` para `locked`. Não muda o número de instruções do lote nem a cobrança antecipada do ADR-022.

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
- Atualização (12/11/2026): depois da janela ativa vêm o resgate de 24 h e a varredura de atrasados, que consulta a cada 3 h, uma rodada por vez, jogos sem resultado e adiados de até 7 dias, só em tick sem jogo na janela ativa ou no resgate (`api/src/matches/poller.ts`)
- Atualização (13/11/2026): a pontuação depois do sync roda uma competição por vez, grava o progresso por jogo e para quando acabam as chamadas da invocação. A competição que não termina continua no tick seguinte (ADR-024)
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

### Atualização — 2026-11-12

A lista toda encerrada muda depois que fica em cache: a sincronização corrige um placar e a pontuação repontua o jogo, ou o operador devolve a competição a piloto. Com a chave só pela URL e o hit respondendo antes de ler o D1, a borda servia o placar antigo por até 24h e continuava entregando a competição rebaixada a quem não tem acesso ao piloto.

- Antes do cache, a rota lê a visibilidade e `matches_version` da competição. Quem não tem acesso ao piloto recebe 404 antes de qualquer leitura do cache. Piloto nunca entra no cache compartilhado.
- A chave usa a versão monotônica da competição, conforme ADR-025. Toda alteração visível muda a versão na mesma transação.
- O `MAX(scored_at)` pelo índice `idx_matches_comp_scored` foi trocado pela versão da competição (ADR-025). O hit lê uma linha de `competitions` pela chave primária. O índice, da migration 0042, ficou sem consumidor no código, e uma migration futura pode removê-lo.
- O TTL de 24h vale só para a cópia guardada na borda. O navegador recebe sempre `private, max-age=60`, porque o cache dele não muda de chave quando o placar é corrigido. A revalidação cai no cache de borda.

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

**Opt-out (LGPD).** Default is opt-in. Suppression is controlled in-app, not by Resend (Resend auto-manages unsubscribes only for its Broadcasts product, not API/transactional sends). `users.email_unsubscribed_at` (NULL = subscribed; migration 0007). The reminder query adds `AND u.email_unsubscribed_at IS NULL`. Each e-mail carries a footer "Cancelar inscrição" link plus RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post: One-Click` headers (Gmail/Apple native button). The link/header point at `GET|POST /notifications/unsubscribe?token=…`. The token is a **dedicated HMAC** (`notifications/unsubscribeToken.ts`), **not** a JWT — reusing the session JWT would turn an unsubscribe URL into a bearer credential; the token carries only the user id, no expiry. Users re-subscribe from the in-app settings page (`/configuracoes` → `GET|PATCH /notifications/preferences`). Events: `email_unsubscribed` / `email_resubscribed` (with `source` = `link`|`settings`|`mailjet`).

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

### Atualização — 2026-11-12

Cancelado continua na flag `postponed`, sem coluna nem status próprios. A football-data mandou como `CANCELLED`, com 0-0 e data nova, um jogo que a ESPN mostra suspenso aos 33 minutos e com retomada marcada (Rayo Vallecano × Athletic, LaLiga 2026/27). Um estado terminal de cancelado tiraria esse jogo do calendário e do encerramento da competição enquanto ele ainda vai ser disputado. Agora nenhum dos dois provedores grava placar em jogo adiado, cancelado ou suspenso. Antes, o 0-0 que a football-data envia nesses status ficava gravado na linha. A tabela de transições está em `docs/architecture/schema.md`, seção "Ciclo da partida".

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
- Falha parcial de slugs é tolerada: o snapshot atualiza os slugs que responderam, e as ligas dos que falharam mantêm o `is_current` do último snapshot válido em vez de sumir do radar. A execução sai como `partial` e o workflow mostra um aviso com os slugs; todos em erro aborta a coleta.
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
- **Pênaltis ficam fora do escopo**: o fallback grava placar e status e zera `postponed`; `penalty_winner` e gols de pênaltis permanecem como estavam. Quando o primário volta, o upsert do sync preenche os campos e zera `scored_at` (mecanismo já existente), disparando re-score com o bônus de pênaltis. Jogo que decide nos pênaltis (`decides_on_penalties`) e termina empatado, no placar do jogo único ou no agregado da volta, não é pontuado enquanto `penalty_winner` estiver vazio: fica sem `scored_at`, volta ao poller nas 24 h da janela de resgate e à descoberta diária enquanto a competição não encerra, e recebe placar, pênaltis e classificado de uma vez quando o primário informar o vencedor. Se o vencedor não vier nesse prazo, o jogo fica pendente, aparece em `finished_unscored` no painel de métricas e só se resolve com correção manual (`UPDATE matches SET penalty_winner = ...` no D1; a pontuação seguinte credita). Volta com agregado empatado sempre espera o vencedor, então uma competição que desempate o agregado por outro critério precisa de tratamento antes de entrar. Os demais jogos pontuam na hora.
- O fallback não usa `postponed` para decidir. Quem barra o adiado é o status da ESPN. Ao encerrar o jogo, ele grava `postponed = 0`: a football-data pode seguir com `POSTPONED` ou `SUSPENDED` atrasado, e sem isso a linha ficava `finished` e adiada ao mesmo tempo (atualização de 12/11/2026). A premissa original, de que um adiado nunca chega em 'post', estava errada. Em 08/11/2026 Estoril × Marítimo veio como `STATUS_POSTPONED` com `state = 'post'`, `completed = false` e placar 0-0, e o fallback gravou um 0-0 final e pontuou. Com esta correção, o fallback e o sync primário da ADR-018 só encerram jogo com `completed = true` e nome fora de `ESPN_POSTPONED_STATUSES` (adiado, cancelado, suspenso e abandonado), pela função `isEspnFinal` de `api/src/providers/espn.ts`. O sync primário também deixa de travar adiado ou cancelado em 'post'. A tolerância de ±150 min continua rejeitando remarcações para outro dia, e o ADR-013 continua sendo a via de resgate desses jogos.
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
- A contagem de pendentes da home soma os jogos abertos da rodada padrão e os jogos futuros abertos das outras rodadas que ficaram para trás: o remarcado tem prazo e a home é o único lugar que avisa dele antes de o usuário abrir o grupo. Adiado sem data nova de rodada antiga continua fora da contagem. A contagem sai de uma varredura só do índice coberto da competição, que numera as candidatas e já traz a rodada padrão e as que ficaram para trás. Os jogos de cada uma vêm de `idx_matches_comp_round_start` com a rodada já resolvida. No `GET /groups`, a CTE `competition_info` em `api/src/groups/groupsList.ts` calcula o status da competição e essas rodadas abertas uma vez por competição distinta do usuário, e cada grupo lê apenas os jogos abertos das rodadas já resolvidas.
- Palpite salvo em que falta o vencedor dos pênaltis também conta como pendente e pode ser o prazo, como no contador da aba Palpitar e no "falta pênalti" do card: a volta cuja soma com o palpite da ida empata e o empate no jogo único de fase com pênaltis. A mesma varredura lista esses palpites, e o Worker confere o confronto com `indexTies` só quando a lista não está vazia. Em liga ela fica vazia. O painel busca a lista de novo de 3 a 10 s depois do horário do prazo, do próximo jogo ou do fim da rodada, num atraso sorteado. Se a resposta ainda trouxer o horário passado, tenta uma vez mais 30 s depois. Horário que já chega passado ganha uma busca só.
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

O digest mostra até 10 grupos na ordem do primeiro jogo sem palpite. O link "e mais N grupos" abre o painel, que lista os demais. HTML e texto puro usam o mesmo corte. O agrupamento usa mapas por usuário, grupo e rodada para evitar busca linear a cada linha. O teste com 500 grupos e 8 jogos exige corpo JSON abaixo de 128 KiB. Esse teto comporta os 80 blocos de jogo dos 10 grupos, o template e a versão em texto. É um teto de regressão desse cenário, pois o tamanho também depende dos nomes e da quantidade de jogos de cada grupo.

O limite de um e-mail por usuário por dia fica no banco, na tabela `email_reminder_sends` (`PRIMARY KEY (user_id, reminder_date)`, migration 0036). O cron reserva todos os destinatários em uma gravação antes do primeiro envio e só envia para quem a reserva devolveu. Um `finally` devolve as reservas sem aceite do provedor, inclusive se a preparação ou o envio abortar por exceção. Cada aceite retira o usuário do conjunto pendente antes das operações seguintes. A liberação é uma das 4 consultas fixas de `D1_SUBREQUESTS`. Se ela falhar, sai uma nova tentativa depois de 250 ms (`D1_RETRY_MS`), na vaga de folga do teto. Falha que persiste vai para o log com a contagem de reservas, sem os ids, e a execução segue até `cron_round_reminder` e a linha `[perf]`. Reenvio dentro de `sendWithRetry` e reexecução no mesmo dia usam o mesmo `Idempotency-Key` do Resend.

A reserva é uma gravação só por execução porque cada consulta ao D1 conta no limite de subrequests do Worker junto com os envios ao Resend.

O plano da conta Cloudflare não está confirmado (`docs/architecture/capacidade-coordenacao-provedores.md`, item 8), então vale o pior caso: Free, com 50 subrequests por invocação. A execução gasta 4 consultas fixas (SELECT, batch de reserva, liberação das reservas e a limpeza de segurança do `scheduled`) e deixa 1 de folga, o que dá um teto de 45 `fetch` ao Resend, reenvios incluídos. Cada tentativa de `sendWithRetry` desconta do saldo. Com o saldo zerado, a fila encerra antes de chamar a rede, cada destinatário restante registra `email_reminder_failed` com `reason = subrequest_budget` e as reservas dele são devolvidas, como na cota esgotada. Quem ficou sem e-mail entra na próxima execução do mesmo dia, se houver, e a reserva impede repetir para quem já recebeu. O teto vem da variável `REMINDER_FETCH_BUDGET` do Worker, com 45 como padrão. Valor que não seja inteiro positivo volta ao padrão e registra erro no log. Acima de 45 só cabe com o plano Paid confirmado.

Quando o teto não cobre todos, a fila de envio começa por quem recebeu o lembrete há mais tempo, pelo dia mais recente em `email_reminder_sends`. Quem ficou de fora num dia não tem linha desse dia e passa à frente, no dia seguinte, de quem recebeu. No empate vale o jogo que fecha primeiro. Antes a fila seguia só o horário do primeiro jogo, e quem tinha jogo apenas à noite ficava de fora todos os dias.

O dia do lembrete e a meia-noite que fecha a lista saem do fuso `America/Sao_Paulo` pela base do `Intl`. Antes vinham de um deslocamento fixo de 3 horas. Se o horário de verão voltar, o jogo de 00:30 do dia seguinte continua fora da lista.

A consulta dos pendentes exclui o grupo de quem tem registro em `group_bans`, pelo `notBannedSql` das outras leituras. O filtro vale mesmo que sobre uma linha em `group_members` para a pessoa banida. É uma busca pela chave primária de `group_bans`, sem leitura a mais por grupo.

Grupo de competição em piloto só entra no e-mail de quem tem acesso ao piloto (`ADMIN_EMAIL` ou `PILOT_EMAILS`), o mesmo critério da lista de grupos.

O descadastro é conferido de novo durante o envio. A gravação da reserva só reserva quem ainda está inscrito, então quem saiu entre a consulta dos pendentes e a reserva fica de fora. Essa leitura vale por 5 segundos (`UNSUB_RECHECK_MS`), contados do início da gravação da reserva. Uma tentativa de envio, inclusive um reenvio, que comece depois desse prazo relê numa consulta só a preferência de todos os destinatários que faltam, e a consulta desconta um subrequest do mesmo saldo de 45. Um lote cheio dura mais de 5 segundos, porque os envios saem um por vez, e gasta de 1 a 3 vagas do teto nessas consultas. Ler antes de cada envio cortaria pela metade quem cabe no teto. Quem descadastrou não recebe, não conta como falha e tem a reserva devolvida. Se a consulta falhar, ela sai de novo depois de 250 ms, com a mesma exigência de saldo para a consulta e um envio e com outro subrequest descontado. Se a nova tentativa falhar ou não couber no saldo, a fila encerra e os restantes registram `email_reminder_failed` com `reason = unsub_check_failed`.

O ponto sem volta é o início do `fetch` ao Resend. Descadastro depois disso não desfaz o e-mail aceito. Um reenvio cancelado por descadastro depois de 5xx ou erro de rede pode ter sido precedido de um aceite que a resposta não confirmou.

#### Adendo (2026-11-20): fallback Mailjet enxuto

Com `MAILJET_API_KEY` e `MAILJET_API_SECRET`, recusa definitiva do Resend na **primeira** tentativa daquele destinatário na execução (4xx de validação/conta, 401/403 ou cota esgotada, sem falha passageira antes) desvia uma vez à Mailjet, só para quem ainda não teve tentativa nesta execução. Timeout, 5xx, rede e qualquer 409 do Resend **não** acionam o fallback: o Resend pode ter aceitado, ou a chave do dia já foi usada (reexecução com corpo diferente → `invalid_idempotent_request`). Se `sendWithRetry` viu um erro passageiro e depois um status que pareceria definitivo (por exemplo timeout → 409, ou 5xx → `daily_quota_exceeded`), marca a falha como incerta e também fica sem Mailjet. 401/403 do Resend tratam a conta como indisponível no restante do lote (mesmo desvio da cota, sem novo `fetch` à Resend por pessoa). Sem os dois segredos o cron é idêntico ao da main. Cada `fetch` da Mailjet conta no mesmo teto de `REMINDER_FETCH_BUDGET`. Não há migration, reconciliação por CustomID nem estados novos: timeout ou 429 da Mailjet mantém a reserva (sem idempotência, não reenvia naquele dia; evita duplicata); recusa definitiva da Mailjet libera a reserva e registra a falha. O envio Mailjet desliga `TrackOpens` e `TrackClicks`. `List-Unsubscribe` e preferências locais seguem iguais aos do Resend. Operação: com a Mailjet ativa, não reexecute o lembrete no mesmo dia depois de falhas incertas (timeout, 5xx ou `UncertainResendError`). A reserva dessas pessoas foi liberada, e uma segunda execução que receba cota esgotada ou 401/403 antes de a Resend checar a idempotência mandaria pela Mailjet um e-mail que a 1ª tentativa pode já ter entregue.

#### Adendo (2026-11-20): sincronização do descadastro via Event API

Em envio real, a Mailjet **substitui** o `List-Unsubscribe` / `List-Unsubscribe-Post` que o Palpitae manda em `Headers` pelos dela (`mailto` em `bnc3.mailjet.com` e `https` em `mjt.lu/unsub2`, com One-Click). Quem cancela pelo botão nativo do Gmail num e-mail de reserva entra só na lista de exclusão da Mailjet e seguiria recebendo pela Resend. O link de cancelamento no corpo do e-mail continua sendo o do Palpitae.

Por isso o Worker expõe `POST /notifications/mailjet-events`, que recebe a Event API da Mailjet para `unsub` e `spam` (objeto ou array agrupado). Para cada evento, resolve o usuário pelo `CustomID` (`lembrete-diario/<userId>/<YYYY-MM-DD>`, a mesma chave de idempotência do lembrete) e, se não achar conta, pelo e-mail; aplica o mesmo efeito do link de cancelamento / Configurações (`users.email_unsubscribed_at`, evento `email_unsubscribed` com `source = mailjet`). Outros tipos de evento são ignorados. Idempotente. Payload inválido responde 200 com log, sem dado pessoal, para a Mailjet não reenviar em loop.

Autenticação: Basic Auth na URL do callback (suportado pela Mailjet). A senha é o segredo `MAILJET_WEBHOOK_SECRET` (usuário livre, ex. `mailjet`), comparado em tempo constante. Sem o segredo no Worker a rota responde 404. URL de cadastro:

`https://mailjet:<MAILJET_WEBHOOK_SECRET>@api.palpitae.com.br/notifications/mailjet-events`

Configuração na Mailjet (depois do deploy e do `secret put`), um `POST` por tipo:

```bash
curl -X POST "https://api.mailjet.com/v3/REST/eventcallbackurl" \
  -u "$MAILJET_API_KEY:$MAILJET_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"EventType":"unsub","Url":"https://mailjet:'"$MAILJET_WEBHOOK_SECRET"'@api.palpitae.com.br/notifications/mailjet-events","Version":2,"Status":"alive"}'

curl -X POST "https://api.mailjet.com/v3/REST/eventcallbackurl" \
  -u "$MAILJET_API_KEY:$MAILJET_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"EventType":"spam","Url":"https://mailjet:'"$MAILJET_WEBHOOK_SECRET"'@api.palpitae.com.br/notifications/mailjet-events","Version":2,"Status":"alive"}'
```

### Consequences

- O `finally` libera as reservas quando a execução termina por retorno ou exceção. Um encerramento forçado do runtime que impeça o `finally`, ou uma falha do próprio D1 na liberação, ainda pode deixar reservas até o fim do dia. A falha de liberação vai para o log.
- Quem nunca palpita recebe um e-mail por dia com jogo, em vez de um por rodada. O volume sobe e consome a cota do Resend. Cota esgotada sem Mailjet encerra a fila e registra `email_reminder_failed` com `reason = quota_exceeded`. Com Mailjet, a cota desvia o restante ao fallback.
- Risco aceito: com o teto de 45 `fetch`, uma base com mais de 45 destinatários no dia deixa o excedente sem e-mail enquanto houver uma execução diária só. A fila por último envio reveza o excedente entre os dias. Se o excedente passar do teto, alguém fica de fora dois dias seguidos, sempre quem recebeu mais recentemente. O desvio à Mailjet também consome o teto.
- O revezamento olha os 7 dias guardados em `email_reminder_sends`. Quem não recebeu nesse período é tratado como quem nunca recebeu.
- `email_reminder_sent` deixa de ter campeonato e rodada, porque um e-mail reúne vários. O evento traz o dia e o número de jogos listados.

## ADR-021: Ranking com pontos e variação da última rodada encerrada

**Status:** Accepted
**Date:** 2026-11-08

### Context

A aba Ranking mostrava posição, jogador, pontos e exatos. O grupo não via quanto cada membro fez na última rodada nem quem subiu ou caiu. Guardar uma foto do ranking por rodada daria números errados, porque os pontos em `predictions` são regravados quando um bônus muda (`classifiedRuleChangeStatements`) ou quando a pontuação é refeita.

### Decision

`GET /groups/:id/round-standings` calcula o resultado na hora em `api/src/groups/roundStandings.ts`. A autenticação e o gate são os de `GET /groups/:id/members`. Os marcos de placares exatos usam as tabelas `exact_milestones` e `exact_milestones_initialized` (migration `0052`).

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

Cada linha também traz `exact_hits`, `exact_milestone` (maior limiar atingido entre 5, 15 e 30 placares exatos no grupo, ou `null`) e `exact_milestones_crossed` (limiares cuja linha em `exact_milestones` tem `round` igual à rodada de referência). O total histórico de exatos do membro vem de `leaderboard.exact_hits`. `EXACT_HIT_SQL` calcula só os agregados da rodada e da rodada em diante na consulta de membros (conta quando `points_exact > points_winner` e `points_awarded = points_exact`).

Consultas de `getRoundStandings` e `recordExactMilestones`:

1. Leitura preliminar das fases (`ROUND_PHASES_SQL`) para obter a rodada de referência candidata. Sem referência a rota devolve `{ round: null, standings: [] }` e não grava.
2. `db.batch` com fases, membros (`ROUND_MEMBERS_SQL`, bind da rodada candidata) e palpites por rodada. O D1 executa o lote numa transação, então as três leituras veem o mesmo estado. Se a referência do lote divergir da candidata, a rota refetcha os membros com a referência do lote.
3. Inicialização: `INSERT INTO exact_milestones_initialized (group_id) VALUES (?) ON CONFLICT DO NOTHING`. Só quem recebe `meta.changes > 0` faz o backfill (`INSERT INTO exact_milestones ... round = NULL` para cada limiar já atingido). Quem perde o marcador segue o caminho de grupo inicializado.
4. Depois de inicializado: para cada limiar `T` com `exact_hits >= T` ainda sem linha, `INSERT INTO exact_milestones (..., round) VALUES (..., referência) ON CONFLICT DO NOTHING`.
5. Releitura de `SELECT user_id, threshold, round FROM exact_milestones WHERE group_id = ?`. O destaque (`exact_milestones_crossed`) sai só das linhas cuja `round` é a referência. A resposta nunca anuncia um marco cuja gravação falhou; a próxima leitura tenta de novo.

A chave primária `(group_id, user_id, threshold)` impede duas leituras concorrentes de gravar o mesmo marco com rodadas diferentes. Grupo novo lido com zero exatos só inicializa; o primeiro cruzamento depois disso recebe a rodada de referência e aparece no resumo. Cruzar 4→5 dispara uma vez; 5→6 na rodada seguinte deixa `exact_milestones_crossed` vazio; 4→15 numa leitura grava e destaca 5 e 15. Repontuação que muda `scored_at` não redispara, porque o destaque depende da linha gravada. Membro que sai e volta mantém a linha. Correção de placar que tira o exato e o devolve não cria outra linha nem muda a rodada. Grupo solo recebe o marco; grupo novo ou zero exatos fica sem selo. No ranking, o selo permanente sai de `members.exact_hits` (mesmo total do `leaderboard`), para continuar visível quando não há rodada de referência. O resumo e o share só destacam o cruzamento quando a rodada selecionada é a referência e `exact_milestones_crossed` não está vazio. O cartão do marco leva o link de convite quando o dono compartilha e o link público de pedido de entrada quando outro membro compartilha (`share_invite` com `context = exact_milestone`). Sem pontos extras.

### Consequences

- Champions e Copa do Mundo perdem a coluna quando o mata-mata começa. Copa do Brasil e Libertadores nunca têm a coluna, porque as fases delas vêm sem número. Competição com `round` por fase, como `REGULAR_SEASON`, também fica sem coluna.
- Jogo adiado que recebe data nova reabre a rodada. Enquanto ele não acaba, a referência cai para a encerrada de maior número, e a coluna pode voltar a uma rodada anterior.
- Cada abertura da aba recalcula a referência varrendo os jogos da competição e soma os palpites do grupo da rodada em diante. Não há cache, e o custo cresce com o número de jogos e de palpites do grupo.
- A variação compara a ordem antes e depois da rodada de referência. Um jogo remarcado de rodada antiga que pontua depois entra no total e na posição anterior como se sempre estivesse lá, sem aparecer como movimento.
- Caso aceito: uma fase preliminar eliminatória adiada que termine depois do início da rodada de referência tira a coluna até uma rodada posterior fechar.
- Risco aceito: uma leitura entre a gravação dos pontos e a atualização do `leaderboard` pode mostrar variação errada por alguns segundos. A próxima abertura da aba corrige.
- A tabela `exact_milestones` sai em cascata com a exclusão de conta (`user_id`, índice `idx_exact_milestones_user`) ou de grupo (ADR-026). A marca `exact_milestones_initialized` pertence ao grupo (`group_id` PK com `ON DELETE CASCADE`) e apaga só com ele; sair ou voltar de um membro não a remove. Sem dados pessoais além dos ids.
- Risco aceito: o destaque do cruzamento aparece na primeira abertura da aba depois que o total cruzou o limiar, na rodada de referência daquele momento. Se ninguém abrir o ranking entre o cruzamento e a troca de referência, o destaque cai na referência seguinte.
- Risco aceito: se a gravação do D1 falhar depois da aquisição do marcador e a liberação do marcador também falhar, o grupo fica marcado como inicializado sem backfill; a leitura seguinte trata limiares antigos como marcos novos com a rodada corrente.

## ADR-022: Workers Free com orçamento diário de linhas do D1 por usuário

**Status:** Accepted
**Date:** 2026-11-13

### Context

A API roda no plano Workers Free. Nesse plano o D1 lê até 5 milhões de linhas e escreve até 100 mil por dia. Quando uma das duas cotas acaba, toda consulta falha até 00:00 UTC, e com elas o login, os palpites, o ranking e os crons ([preços do D1](https://developers.cloudflare.com/d1/platform/pricing/)). O plano também aceita até 100 mil requisições por dia ao Worker.

O limitador por minuto do ADR-017 conta requisições e não o trabalho que cada uma gera no D1. A auditoria de segurança de 13/11/2026 mostrou que uma só conta gratuita esgota as cotas do dia. Cerca de 200 `GET /groups` de uma conta com centenas de grupos passam de 5 milhões de linhas lidas, e umas 100 chamadas a `POST /predictions/replicate` passam de 100 mil linhas escritas.

O plano Workers Paid cobra o excedente em vez de cortar o D1 e tem assinatura mensal.

### Decision

O operador decidiu em 13/11/2026 ficar no Workers Free e impor no código os limites que o plano não impõe. Os tetos de grupos criados e de participações por usuário estão em `api/src/groups/groupCaps.ts`. Esta ADR acrescenta o orçamento diário de linhas do D1.

Cada usuário com sessão válida tem por dia 250 mil linhas lidas e 5 mil escritas, 5% de cada cota. O dia vira à 00:00 UTC, junto com as cotas. As variáveis `D1_DAILY_ROWS_READ_PER_USER` e `D1_DAILY_ROWS_WRITTEN_PER_USER` substituem os padrões. Um valor que não seja inteiro positivo volta ao padrão e registra erro no log.

O limitador `requestLimits`, em `api/src/security/limits.ts`, troca o `DB` do contexto da requisição por um medidor antes de validar a sessão. O medidor `meterD1Rows`, em `api/src/security/d1Usage.ts`, embrulha o D1 num `Proxy` e soma o `rows_read` e o `rows_written` que o D1 informa no `meta` de cada consulta. Nenhuma rota muda o jeito de consultar. O limitador guarda o `DB` original e faz nele as próprias consultas, a leitura do orçamento, o balde por minuto e a gravação do balde diário. Assim o uso medido é só o da sessão e do handler. O embrulho reaproveita `interceptD1` (`api/src/d1Intercept.ts`), o mesmo que `countD1Calls` usa no orçamento de chamadas do ADR-024.

Antes do handler, o limitador lê as duas linhas do usuário em `request_limits`, uma de linhas lidas e outra de escritas, com a janela no início do dia UTC. Se uma delas chegou ao limite, a resposta é 429 com `Retry-After` até a virada, calculado com o mesmo instante usado na checagem, e uma mensagem em português que o front mostra como os outros erros da API. A recusa só lê e vem antes do balde por minuto, que gravaria uma linha. `/auth/logout` e `/auth/logout-all` nunca são recusados pelo orçamento, porque quem tem um token roubado poderia gastar o dia e impedir a vítima de sair.

Depois do handler, uma só consulta soma o total da requisição ao balde. Ela grava a linha de leitura só se a requisição leu alguma linha e a de escrita só se escreveu alguma. Sem uso nenhum, não grava nada. A própria gravação não tem como se medir. Quando a requisição escreveu, a linha de escrita leva também 2 linhas por linha do balde gravada nessa consulta, a linha e a entrada dela no índice de expiração. São 2 com só a linha de escrita e 4 com as duas. Numa requisição só de leitura, as 2 linhas que a gravação do balde de leitura escreve ficam fora do orçamento de escrita do usuário, para que ler não corte ninguém por escrita. A limpeza dos crons apaga as linhas do dia anterior, como os demais contadores.

Se a leitura do balde falhar, vale a política do ADR-017. Leituras passam e escritas e OAuth respondem 503. Se a gravação depois do handler falhar, a resposta já está montada e a falha só registra `security_storage_error`.

Limites da medição:

- O `first()` do D1 não devolve `meta`. O medidor troca a chamada por `all()`, que executa a mesma consulta, e devolve a primeira linha ou a coluna pedida. Um fake de D1 em teste que passa pela API inteira precisa implementar `all`.
- `raw()` e `exec()` também não devolvem `meta` e passam sem medir. O código da API não usa nenhum dos dois.
- Consulta que falha não entra na conta.
- O balde recebe só o que passou pelo `DB` medido até o fim do handler. Uma consulta feita com ele depois da resposta, como dentro de `ctx.waitUntil`, e as feitas por `db.withSession()` ficam fora. Hoje nenhuma rota faz isso.
- Requisições sem sessão válida não têm orçamento diário. Elas continuam só no limitador por minuto, por IP.
- Uma requisição que começa com saldo termina mesmo que passe do orçamento, e requisições simultâneas do mesmo usuário passam pela checagem antes de alguma gravar. O limitador por minuto limita esse excesso. Nas rotas em lote `POST /predictions/replicate`, `POST /predictions/import` e `PUT /predictions/bulk`, o handler consulta `request_limits` fora da medição antes do `db.batch`. Se as instruções planejadas passarem do saldo restante de escrita do usuário, ele devolve 429 com `Retry-After` e não grava nenhuma linha. O `import` aceita no máximo 1.000 instruções planejadas por requisição, o mesmo teto do `replicate`. A checagem prévia conta 1 unidade do saldo por instrução planejada, inclusive a do marcador de importação. Antes da execução, o handler não sabe se a instrução insere uma linha nova, com até 4 linhas gravadas contando os índices, atualiza uma existente ou é recusada pela trava do jogo. Por isso um lote aceito com inserções novas pode gravar até cerca de 4 vezes o saldo restante. O desconto real depois do handler segue vindo do `rows_written` informado pelo D1, sem cobrança dupla. Um multiplicador fixo recusaria um lote válido, como 400 palpites com saldo de 500.

O flood anônimo distribuído contra as 100 mil requisições por dia do Worker é risco aceito. O limitador por IP e a regra de rate limit da borda, descrita em [Controle de acesso e limites da API](../security.md), cortam um cliente sozinho. Muitos IPs juntos ainda esgotam a cota de requisições.

O gatilho para migrar ao Workers Paid é a primeira queda por cota, ou o uso diário acima de 50% de uma cota do D1 ou de requisições por 3 dias seguidos.

O cron das 00:05 UTC mede o uso do dia anterior pela API GraphQL de analytics e grava `cloudflare_quota_alert` quando uma cota passa de 50% ou de 80%. O painel `/admin/metricas` mostra a última medição. Ver [Observabilidade](../observability.md#uso-das-cotas-do-plano-free-cloudflare_usage).

### Consequences

- Cada requisição autenticada faz 2 chamadas a mais ao D1, a leitura do orçamento e a gravação, dentro das 50 por invocação. As rotas em lote fazem também 1 leitura do saldo restante antes do `db.batch`.
- Contando 2 linhas escritas por linha de contador, com a entrada no índice de expiração, uma requisição autenticada só de leitura grava 4 linhas no D1. São 2 do contador por minuto e 2 da linha de leitura do balde diário. A cota de 100 mil escritas comporta 25 mil dessas requisições por dia. Uma requisição que escreve `w` linhas grava `w + 6` no D1, e a cota comporta `100.000 / (w + 6)` delas.
- Nenhuma dessas linhas do limitador entra no orçamento de escrita de uma requisição só de leitura, e um usuário que só lê é cortado apenas pelas 250 mil linhas lidas. Uma requisição que escreve `w` linhas cobra `w + 4` do orçamento, e o corte vem depois de `5.000 / (w + 4)` delas no dia. Um palpite que grave 4 linhas com os índices de `predictions` corta em 625 palpites. Se o uso normal chegar perto disso, suba `D1_DAILY_ROWS_WRITTEN_PER_USER`.
- Vinte contas no teto de escrita, ou vinte no de leitura, somam a cota do dia. O orçamento impede que uma conta sozinha derrube o app. Um ataque com muitas contas fica no risco aceito.
- `api/src/security/dailyD1Budget.test.ts` e `api/src/predictions/batchBudget.test.ts` rodam a API inteira sobre o D1 em memória embrulhado por `api/src/testing/d1RowsReported.ts`, que informa linhas lidas e escritas por consulta. O SQLite em memória sozinho não informa.

### Alternatives Considered

**Acumulador em memória por isolado, com limiar de flush.** Cada isolado do Worker somaria em memória o uso de cada usuário e só gravaria o balde ao passar de um limiar, por exemplo 2.500 linhas lidas ou 50 escritas. Com perto de 100 linhas lidas por requisição, a escrita do balde cairia para cerca de 1 gravação a cada 25 requisições de leitura.

- A favor, a escrita do limitador no D1 cai para perto de só a do contador por minuto, e a cota de escritas comporta bem mais requisições autenticadas.
- Contra, o isolado é efêmero. A Cloudflare descarta isolados sem aviso, e o saldo ainda não gravado se perde. Cada isolado vivo do mesmo usuário guarda até um limiar sem gravar, então o excesso possível cresce com o número de isolados. A checagem lê um balde atrasado em até um limiar por isolado.
- Não adotado agora. Com as consultas do limitador fora da medição e sem gravar a linha sem uso, uma requisição só de leitura grava 4 linhas e não gasta o orçamento de escrita. Fica como follow-up se a cota de escritas virar o gargalo antes do gatilho de migração ao Paid. A imprecisão continuaria limitada ao limiar vezes o número de isolados.

## ADR-023: Palpite revelado fica travado para sempre

**Status:** Accepted
**Date:** 2026-11-14

### Contexto

O ponto 3 do ADR-013 exige que a revelação dos palpites de grupos ocultos impeça novas edições. A leitura revela o palpite quando o kickoff passa com `postponed = 0`. Antes desta correção, um sync posterior de adiamento, cancelamento ou horário mais tarde podia reabrir a escrita sem apagar o que os outros participantes já tinham visto.

### Decisão

O upsert dos dois provedores persiste em `locked_at` o instante do sync quando a linha anterior tem `postponed = 0` e `start_time` menor ou igual ao instante do sync. A comparação usa segundos UTC, no formato imposto pela migration 0043. Continuam valendo as travas por status iniciado do provedor e por status local `live` ou `finished`. `COALESCE` preserva a primeira trava gravada.

O filtro de escrita condicional do upsert considera essa mesma condição. A primeira sincronização após o kickoff grava a trava, mesmo sem mudança de payload; repetições seguintes continuam sem gravação. A comparação usa os campos anteriores à atualização, Assim, a nova data ou o novo adiamento não apagam a trava.

### Consequências

- Um adiamento que o sync vê antes do kickoff mantém a edição aberta até a nova data. Antes do kickoff, o jogo só é sincronizado pela descoberta diária às 06:15 UTC, pelo sync manual do admin ou pelo poller de um jogo anterior da mesma rodada ou do mesmo dia. Um adiamento anunciado depois desse sync deixa o jogo travado, inclusive depois da remarcação, porque a leitura já revelou os palpites no horário gravado. Não existe caminho para reabrir. Um sync manual antes do kickoff, quando o operador sabe do adiamento, evita a trava.
- A regra vale para todos os grupos que usam o jogo. A trava pertence a `matches` e independe de alguém ter consultado a revelação.
- Jogos reabertos antes do deploy ficam como estão. Jogos já reabertos exigem investigação histórica antes de qualquer reparo. A [consulta de investigação](../trava-monotonica.sql) só lê dados e documenta os limites de `updated_at` e da ausência do horário original no banco.

---

## ADR-024: Pontuação por jogo com orçamento de chamadas por invocação

**Status:** Accepted
**Date:** 2026-11-13

### Context

`scoreUnprocessedMatches` pontuava a competição inteira de uma vez. Lia os palpites de todos os jogos encerrados sem `scored_at`, gravava os pontos em lotes de 100 instruções e só no fim marcava os jogos e recalculava o ranking. Se um lote falhava, nenhum jogo recebia `scored_at` e a execução seguinte refazia tudo.

No plano Free uma invocação do Worker faz no máximo 50 chamadas. Cada consulta ao D1 conta uma e um `db.batch()` inteiro conta uma ([limites do D1](https://developers.cloudflare.com/d1/platform/limits/)). Sozinha, a pontuação de uma competição com 4.700 palpites usava as 50 chamadas, 47 em lotes de pontos e 3 em leitura e marcação, sem contar o planejamento e o sync do mesmo tick. Acima disso a chamada 51 falhava, todos os jogos seguiam sem `scored_at` e a falha se repetia a cada tick. O poller pontuava as competições em paralelo na mesma invocação, então a outra competição do tick também ficava sem pontuação. A auditoria de segurança de 13/11/2026 reproduziu o caso com uma conta que cria 470 grupos e replica os palpites numa rodada de 10 jogos.

### Decision

A pontuação grava o progresso por jogo. `scoreUnprocessedMatches` percorre os jogos do mais antigo para o mais novo, uma gravação por vez. Cada gravação é um `db.batch()`, que o D1 executa como transação, com os pontos dos palpites dos jogos dela, o `scored_at` de cada jogo e o ranking dos grupos que têm palpite nesses jogos. Jogo com `scored_at` não volta na execução seguinte.

Os pontos de um jogo vão em instruções `UPDATE predictions ... FROM json_each(?)` de até 1000 palpites cada, em vez de uma instrução por palpite. Um jogo com qualquer número de palpites cabe numa gravação. Jogos com poucos palpites dividem a mesma gravação até somar 250 palpites ou 25 jogos. A pontuação custa até 2 chamadas de planejamento (jogos pendentes e confrontos de mata-mata) e 2 por gravação (leitura dos palpites e o batch).

A ida e a volta de um confronto ficam na mesma gravação. Quando a ida tem o placar corrigido, a volta já pontuada é repontuada junto. Se a ida fosse gravada sozinha, ela sairia da lista de pendentes e a execução seguinte não acharia a volta para refazer.

O poller tem um orçamento explícito, `POLLER_CALL_BUDGET`, de 45 das 50 chamadas da invocação (`api/src/matches/poller.ts`). As 5 restantes cobrem a limpeza de registros expirados que o handler `scheduled` dispara na mesma invocação, a leitura final dos jogos sem pontuação e 3 de folga. `countD1Calls` (`api/src/matches/callBudget.ts`) embrulha o D1 do tick e soma cada consulta e cada batch. Cada tentativa HTTP aos provedores soma também, porque a [documentação de limites do Workers](https://developers.cloudflare.com/workers/platform/limits/) define subrequest como `fetch` ou chamada a serviços como o D1 e dá um limite só por invocação. Planejamento, sync e fallback gastam o que precisam e são só contados. A pontuação recebe o que sobra.

As competições são pontuadas uma por vez. Entram as que o poller sincronizou no tick e as que têm jogo encerrado, com placar e sem `scored_at`, que o poller lê depois do sync pelo índice parcial `idx_matches_unscored`. A leitura custa 1 chamada do orçamento e roda também em tick sem jogo na janela. Sem ela, a competição que parou por falta de chamadas, ou por erro, só voltava a ser pontuada num tick em que o sync dela desse certo, e nunca mais depois das 24 h do resgate.

A ordem segue o jogo pendente mais antigo de cada competição, então a que ficou sem a vez num tick começa o seguinte. Cada uma recebe uma parte igual das chamadas que restam, nunca abaixo das 4 que planejar e gravar uma vez exigem, enquanto restarem 4. Sem esse piso, 11 chamadas para 3 competições davam 3 à primeira, que era pulada em todo tick. O que sobrar vai, numa segunda passada, para as que pararam por falta de chamadas. Assim uma competição com muitos palpites não gasta a vez das outras. A que não termina devolve `complete: false` e continua no tick seguinte de onde parou. Erro na pontuação de uma competição gera `match_scoring_error` e as outras seguem. Depois que todas tiveram a vez, o poller registra `poller_run` com `error` e relança a primeira falha, para a invocação aparecer como exceção na Cloudflare.

Ao fim de cada tick o poller lê, pelo índice parcial `idx_matches_unscored`, as competições com jogo encerrado sem `scored_at` que começou há mais de 145 minutos, e registra um `match_unscored` por competição, com no máximo 10 por execução. Os 145 minutos somam os 115 do resultado mais cedo possível e os 30 de um tick, então o jogo já passou por um ciclo inteiro sem ser pontuado. O painel `/admin/metricas` lista essas competições em "Jogos encerrados sem pontuação" (`GET /metrics/ops`, campo `unscoredMatches`).

O jogo decisivo empatado que espera o vencedor dos pênaltis continua na leitura de pendentes. A competição dele é planejada em todo tick até o provedor informar o vencedor, com até 2 chamadas e nenhuma gravação. Filtrar esse jogo no SQL exigiria repetir a regra de `awaitsPenaltyWinner`, que depende do confronto e do placar da ida. Com 45 chamadas no orçamento e a espera limitada ao atraso do provedor, essas 2 chamadas cabem no tick.

A descoberta diária e o sync manual chamam `scoreUnprocessedMatches` sem teto de chamadas. O progresso por jogo vale também para eles. Uma falha no meio deixa pontuados os jogos já gravados.

### Consequences

- No teste `api/src/matches/scoringBudget.test.ts`, que roda o cron inteiro sobre um D1 que rejeita a chamada 51, uma competição com 5 mil palpites em 40 jogos termina em 2 ticks e a competição pequena do mesmo tick é pontuada no primeiro. A rodada da auditoria, com 10 jogos e 4,7 mil palpites, é pontuada inteira num tick com 41 das 45 chamadas do orçamento. No mesmo arquivo, uma competição que parou no orçamento termina em tick sem jogo na janela, 25 h depois do início, e em tick em que o sync dela falha. `api/src/matches/scoringShare.test.ts` mostra três competições com 11 chamadas para a pontuação, todas com jogo pontuado em dois ticks.
- Continuam valendo a gravação condicional ao resultado lido, a repontuação da volta, a espera pelo vencedor dos pênaltis no jogo decisivo empatado, o grupo excluído sem pontuação e o classificado contado uma vez por confronto. Os testes de `scoringRace.test.ts`, `tieClassified.test.ts`, `penaltyWinnerPending.test.ts` e `groups/deletedGroup.test.ts` cobrem essas garantias.
- Uma competição com backlog grande leva vários ticks de 30 minutos. O ranking dos grupos dela mostra os jogos já gravados enquanto o resto espera.
- `match_unscored` também sai para o jogo decisivo que espera o vencedor dos pênaltis, a cada tick, até o provedor informar. Um resultado que chega atrasado ou uma correção que a pontuação não consegue gravar no mesmo tick aparece um ciclo antes, porque o critério é o horário de início e não o momento em que o resultado chegou.
- O orçamento conta o sync e não o limita. Um tick com muitas competições na janela pode gastar as 50 chamadas só no sync. Nesse caso a pontuação não roda, os jogos aparecem em `match_unscored` e a chamada que passar do limite falha no próprio sync.
- O orçamento conta chamadas. O limite de 10 ms de CPU do Cron Trigger no plano Free fica fora da conta.
- A descoberta diária segue sem orçamento. Ela pontua cada competição logo depois do sync dela, em paralelo com as outras.
- O D1 de teste em memória não tem o limite de 50 chamadas. `api/src/testing/d1CallLimit.ts` impõe o limite nos testes, com contagem própria, separada da de produção, que soma as chamadas ao D1 e o `fetch` stubado dos provedores.

---

## ADR-025: Versão monotônica do cache de jogos e correções de contexto

**Status:** Accepted
**Date:** 2026-11-14

### Context

O cache de borda de `GET /matches` usava o `MAX(scored_at)` da competição na chave. Uma correção que zerava o `scored_at` do jogo mais recente fazia o MAX voltar a um valor anterior, e a borda servia a entrada gravada com aquela chave até a pontuação seguinte. O fallback da ESPN e a descoberta também escrevem jogos, então invalidar só no upsert do sync deixaria esses caminhos sem cobertura.

Duas correções do provedor também estavam expostas. Um evento da football-data com o mesmo time nos dois lados chegava ao upsert, e o gatilho de inversão de palpites da migration 0039 rodaria sobre um confronto inválido. A guarda de pontuação não comparava times, fase, perna nem horário, então uma correção concorrente deixava gravar pontos calculados sobre o jogo antigo.

### Decision

A migration 0044 acrescenta `competitions.matches_version INTEGER NOT NULL DEFAULT 0`. Gatilhos de inserção, de exclusão e de atualização em `matches` incrementam o contador na mesma transação. O gatilho de atualização compara os valores antigos e novos dos campos que a lista exibe, e atualizar só `scored_at` não o dispara. Mudanças de nome, sigla ou escudo de `teams` e de `penalty_phases` em `competitions` também incrementam a versão das competições afetadas.

A chave do cache usa `matches_version` junto da competição e dos filtros. O parâmetro passa de `scored` para `matches_version`, e nenhuma chave nova coincide com uma entrada gravada pelo Worker anterior. A consulta que roda antes do cache lê uma linha de `competitions` pela chave primária. O upsert mantém seu filtro de mudanças, então um sync sem correção grava 0 linhas e preserva a versão.

O mapeamento da football-data descarta `same_team` como `invalid_event` e registra `sync_event_discarded`, como o da ESPN. Os gatilhos `matches_distinct_teams_insert` e `matches_distinct_teams_update` recusam times iguais na inserção e na atualização. Eles são BEFORE e rodam antes do `matches_swap_predictions` (0039, AFTER), então um confronto com times iguais aborta antes de inverter palpites. Isso vale também para bancos que já aplicaram a 0039, sem substituir o gatilho dela. Uma linha antiga com times iguais aceita UPDATE sem as colunas de time no SET, como os da pontuação e do fallback da ESPN. O upsert sempre grava essas colunas, e os dois mapeamentos descartam o evento antes.

A guarda de pontuação compara times, fase, perna e horário do jogo e da ida usada no cálculo, e uma correção concorrente impede a gravação do resultado antigo. O gatilho `matches_rescore_context` zera `scored_at` do próprio jogo em qualquer fase. O par antigo e o par novo do confronto só voltam à fila em fase eliminatória, porque `indexTies` só monta confronto nelas. A lista literal de fases do gatilho é a de `KNOCKOUT_PHASES` em `rounds.ts`, e `providerRobustness.test.ts` confere as duas. O upsert também zera o marcador ao alterar perna ou horário efetivo.

A ordem de deploy e a reversão estão no cabeçalho da migration.

### Consequences

O custo de escrita foi medido no D1 local (workerd).

- Cada gravação que muda um campo exibido de `matches` grava também uma linha de `competitions`. A coluna não tem índice.
- Mudar o escudo de um time ou `penalty_phases` grava 2 linhas e sobe a versão.
- Um lote de 100 inserções grava 700 linhas, 100 delas do contador, e a versão vai de 6 a 106.
- Atualizar só `scored_at` grava 2 linhas e não sobe a versão. Um sync sem mudança grava 0.
- O contador acrescenta cerca de 15% a 20% de escrita por gravação visível de jogo.
- A descoberta de um calendário de 380 jogos grava 380 linhas a mais, uma vez por temporada.
- Cada repontuação reescreve todos os palpites do jogo e o ranking dos grupos afetados. Por isso o gatilho de repontuação fica restrito às fases eliminatórias.

O gatilho roda dentro da escrita existente e não acrescenta chamadas ao poller do ADR-024. Alterações de time consultam `matches` para achar as competições afetadas.

O índice `idx_matches_comp_scored` (0042) ficou sem consumidor no código. Uma migration futura pode removê-lo.

O navegador mantém o TTL de 60 segundos. Uma requisição que leu a versão antes de um sync concorrente responde com a lista daquele instante. A requisição seguinte lê a versão nova. As entradas antigas expiram pelo TTL da borda.

## ADR-026: Exclusão de conta transfere o grupo e o papel de dono segue `groups.owner_user_id`

**Status:** Accepted
**Date:** 2026-11-14

### Context

A exclusão de conta é feita pelo operador, a pedido do titular por e-mail, e a página `/privacidade` promete apagar os dados em até 30 dias. `groups.owner_user_id` referencia `users(id)` sem cascata, então `DELETE FROM users` de uma conta dona de grupo falha na chave estrangeira. O papel de dono também vivia em dois lugares sem ligação: a autorização das ações de dono lê `groups.owner_user_id`, e a lista de membros mostra o selo e o botão de remover a partir de `group_members.role`. Trocar o dono à mão deixava a interface mostrando o dono antigo.

Apagar um jogo duplicado direto no banco leva os palpites dele em cascata, mas o `leaderboard` é materializado e o upsert da pontuação só alcança quem ainda tem palpite. Quem palpitou só no jogo apagado mantinha os pontos dele no ranking.

### Decision

Decisão do operador de 14/11/2026: na exclusão da conta de um dono, o grupo passa ao membro ativo mais antigo. Ativo é quem tem linha em `group_members` e não está em `group_bans`, sem contar a própria conta. Mais antigo é o menor `joined_at`; no empate, vence o menor `user_id`, o mesmo desempate do ranking (`rankingOrderSql`). Grupo sem outro membro ativo é apagado, com palpites, ranking e banimentos em cascata. A regra vale também para grupo já excluído pelo dono (`deleted_at`), que continua excluído com o novo dono.

`DELETE /admin/users/:id`, só para o admin, faz tudo numa transação do D1: transfere os grupos, apaga os que ficaram sem membro, apaga as linhas de `payments` da conta (tabela sem uso e sem cascata) e apaga a conta. A cascata leva perfil, participações, palpites, ranking, banimentos, palpites de chave, reservas de lembrete e marcos de placares exatos (`exact_milestones`). A sessão deixa de valer na requisição seguinte, porque `verifySession` exige a conta no banco. O admin não exclui a própria conta pela rota.

`DELETE /admin/matches/:id`, também só para o admin, apaga o jogo e, na mesma transação, refaz o ranking de todos os grupos não excluídos da competição: zera as linhas e soma de novo os palpites que sobraram. Se o jogo é de fase eliminatória, o outro jogo do confronto (mesma fase, mando invertido) volta à fila de pontuação, como no gatilho `matches_rescore_context` da 0044.

A migration 0045 deriva `group_members.role` do dono do grupo: um backfill corrige as linhas atuais, um gatilho em `groups` acompanha a troca de `owner_user_id`, e gatilhos de inserção e de atualização em `group_members` regravam o valor derivado no lugar de um papel incoerente. Os gatilhos corrigem em vez de recusar, então o Worker anterior segue funcionando (expand).

### Consequences

- O novo dono pode passar do teto de 20 grupos criados ativos (`groupCaps.ts`). O teto só é checado na criação; ele fica sem poder criar grupos até sair de algum.
- Um grupo excluído transferido continua invisível e sem pontuação; a transferência só libera a chave estrangeira.
- A contagem de entradas por convite do painel (`role = 'member'`) passa a contar o dono antigo de um grupo transferido à mão, e deixa de contar o novo dono. A diferença já aceita entre essa contagem e os eventos registrados cobre esse caso.
- A marca `predictions_import_completed` fica na linha de `group_members` e sai com o membro. Quem sai e volta ao grupo mantém os palpites e vê o seletor de importação aberto de novo. Comportamento aceito.
- O roteiro do operador está em `docs/operations/exclusao-conta-jogo.md`.

---

## ADR-027: Orçamento compartilhado e fila durável de sync da football-data

**Status:** Accepted
**Date:** 2026-11-16

### Contexto

A football-data.org do plano Free limita a 10 requests por minuto, e o limite vale entre execuções: o poller (a cada 30 min), a descoberta diária (1×/dia), o sync administrativo, os retries internos e os ticks que se sobrepõem não dividiam nenhuma contagem comum. Dentro de uma invocação havia teto de paralelismo (`FD_MAX_CONCURRENT_REQUESTS`) e pausa de isolate após um 429 (`footballDataQuota.ts`), mas nada controlava requests por minuto entre isolates, execuções e processos. Uma rajada de descoberta mais poller no mesmo minuto podia passar dos 10 e o retry de 6 s ia para a mesma janela cheia.

O trabalho que falhava também não durava: uma descoberta que errava em 06:15 só voltava no dia seguinte, um 429 de resultado ficava para o próximo tick (30 min) e o que passasse da janela de resgate de 24 h ficava por conta da varredura de atrasados, uma rodada a cada 3 h.

O estudo do [ticket 01](https://github.com/pedrosatin/palpitae/issues) da resiliência comparou as alternativas (D1, Durable Object, Queues, Workflows, KV, binding de rate limiting, GitHub Actions, Redis externo) nas PRs #625, #626 e #627. Decisão do operador de 14/11/2026: todos os provedores seguem no plano grátis e a coordenação fica no D1, com a capacidade dimensionada pelos limites grátis; as hipóteses não medidas ficam registradas nessas PRs.

### Decisão

Coordenação em duas tabelas D1 (migration 0046), uma camada de acesso no cliente da football-data e um cron drenador:

- **`provider_rate_state`, a razão de orçamento.** Uma linha por provedor. Antes de cada request, `reserveFootballDataSlot` (`api/src/matches/providerBudget.ts`) reserva uma vaga num único `UPDATE` condicional: a janela é o minuto corrente e o orçamento é `FD_CALLS_PER_MINUTE = 8`, 80% do free tier documentado. O D1 serializa escritas, então isolates e execuções diferentes dividem a mesma janela; reserva recusada não consome vaga e não chama o provedor. Um 429 (ou cota zerada) grava `blocked_until` com o reset que a resposta informou (cap de 1 h) ou, sem reset válido, a espera conservadora de 60 s — e nenhuma reserva passa disso. A pausa por isolate continua (`waitForFootballDataQuota`) e é checada antes da reserva.
- **`provider_work`, a fila durável.** Uma linha por chave de deduplicação (provedor, tipo, competição, temporada, rodada) — `result` (poller, prioridade 0), `late` (varredura, 1), `manual` (sync administrativo, 1) e `discovery` (2). Concluída ou falha, a linha é reusada pelo próximo planejamento, então a tabela cresce com rodadas, não com execuções, e não precisa de limpeza. Cada item guarda tentativas, prazo de retomada (`not_before`), lease de execução (`lease_until`, 5 min) e o último erro. O teto é de 6 tentativas de execução por ciclo de planejamento; o produtor revive o item.
- **Camada de acesso.** Todo request à football-data sai de `fetchMatchesFromApi`, que espera a pausa do isolate, reserva a vaga e grava o bloqueio que a resposta impõe. Os chamadores ligam isso com `coordinate: true` — poller, descoberta e dreno sempre; o sync administrativo liga e, sem vaga, devolve `{ ok, pending }` e adia o item. Chamada sem a flag fica fora do orçamento, como as exceções declaradas.
- **Adiamento e dreno.** O sync direto segue como era; qualquer falha do chamador (sem vaga, cota, rede, 5xx, gravação) vira item pendente por `deferProviderWork`, com o prazo da cota quando o erro a informa e a espera conservadora nos demais. O drenador (`footballDataDrain` em `api/src/matches/fdWork.ts`, chamado por `runProviderDrains`, agendado nos minutos 5, 10, 20, 25, 35, 40, 50 e 55 do trigger fundido com o poller — ver o adendo abaixo) reclama itens prontos por prioridade com um `UPDATE ... RETURNING` — dois drenos nunca executam o mesmo item —, executa com o teto de syncs em voo e retoma também o que ficou em execução com lease vencido. A descoberta que falha de dia volta no mesmo dia, e pendências de resultado sobrevivem muito além das 24 h do resgate. Cada execução registra `provider_work_run`.

O fluxo do poller e da descoberta muda o mínimo: o sync segue direto no tick e na descoberta, e só a falha muda de forma — vira item durável em vez de log solto. A ESPN ficou fora da decisão original: seguia com teto e pacing por isolate. A coordenação dela é o adendo do ticket 03, no fim deste ADR.

**Exceções explícitas, fora do orçamento** por serem processos externos sem acesso ao D1 do Worker: o radar de competições (GitHub Actions, ESPN + Wikimedia, ADR-015) e `api/scripts/test-results-api.ts` (desenvolvimento local). A decisão sobre o radar está no adendo do ticket 03, no fim deste ADR.

### Consequências

- O orçamento de 8/min é janela fixa: 8 chamadas no fim de um minuto e 8 no começo do seguinte podem somar 16 num minuto deslizante. Se o contador do fornecedor for deslizante, o excesso vira 429 — que agora tem reset, bloqueio compartilhado e retomada durável. A margem de 20% existe para essa aproximação; mudá-la é alterar `FD_CALLS_PER_MINUTE`.
- Cada tentativa consome 1 escrita a mais no D1 (a reserva), além das gravações de bloqueio e da fila. No pior caso do estudo (~1.200 tentativas/dia), são ~3 mil linhas/dia, ~3% da cota Free de escrita (PR #625).
- O drenador não tem trigger próprio: divide com o poller o trigger fundido (adendo abaixo). Sem nada pendente, o dreno custa 1 consulta ao D1 (a reclamação vazia).
- O lease de 5 min admite execução duplicada em corrida rara (dreno e tick no mesmo item); o upsert é idempotente e sem mudança não grava, então o duplicado custa uma chamada.
- O prazo de retomada de um item `pending` não é reescrito por um novo adiamento do produtor; quem manda no prazo entre os ciclos é o dreno.
- Retenção: as linhas de `provider_work` são reusadas e ficam; `provider_rate_state` tem uma linha por provedor. Nenhuma das duas cresce com o histórico — medição histórica segue no Analytics Engine e no export diário.
- Testes: `providerBudget.test.ts` (reserva, janela, bloqueio), `providerWork.test.ts` (fila, deduplicação, lease, teto de tentativas), `providerCoordination.test.ts` (ponta a ponta com provedor simulado: concorrência, 429 com e sem reset, reinício, recuperação além de 24 h, reprocesso idempotente e prioridade) e `drainSubrequests.test.ts` (o dreno sob os 50 subrequests por invocação, adendo "subrequests do dreno"). O teto de orçamento sobe para os demais testes de pipeline em `src/testing/vitest.setup.ts`, que não o exercem.
- Hipóteses herdadas do estudo, não medidas: janela do fornecedor fixa ou deslizante e o consumo real do D1 em produção. A observação pós-implantação, sem carga artificial, é entrega do ticket. O plano da conta Cloudflare **não é hipótese**: é Free (ADR-022; o erro 10072 do adendo abaixo é o limite de 5 triggers por conta do plano Free). O estudo supunha "provavelmente Paid", e a descoberta de 48 fetches mais as consultas ao D1 passa mesmo dos 50 subrequests do Free; o orçamento de subrequests do dreno (último adendo) parte do teto de 50.

### Adendo (2026-11-17): drenador fundido ao trigger do poller (erro 10072)

**Problema.** A PR #769 registrou o drenador como um 5º Cron Trigger (`5,10,20,25,35,40,50,55 * * * *`). O Deploy API da `main` (run 44009052934, job "Deploy Worker") falhou com `This account has reached the Workers Free limit of 5 cron triggers per account [code: 10072]`: o limite do plano Free é de 5 triggers por **conta**, somando todos os Workers, e a conta já usa 1 em outro Worker. A migration 0046 e o código subiram, mas o drenador não foi agendado, e todo push na `main` passou a falhar no deploy.

**Decisão do operador.** Voltar a 4 triggers, sem custo, fundindo o drenador no trigger do poller. `wrangler.toml` e `api/src/crons.ts` declaram `0,5,10,20,25,30,35,40,50,55 * * * *` (`POLLER_AND_DRAIN_CRON`), e o handler `scheduled` despacha pelo minuto UTC de `controller.scheduledTime`: nos minutos 0 e 30 roda só o `pollActiveMatches`; nos demais, só o `drainFootballDataWork`. Os outros três crons (`5 0 * * *`, `0 10 * * *`, `15 6 * * *`) ficam como estavam.

**O que muda e o que não muda.**
- O drenador continua a cada 5–10 min (minutos 5, 10, 20, 25, 35, 40, 50 e 55). Só o agendamento passa a ser compartilhado com o poller.
- Nos minutos 0 e 30 só o poller roda: o drenador não atrasa nem compete com ele e retoma no minuto 5 ou 35.
- Cron distinto dispara independente do fundido. O minuto 5 do trigger fundido também cai às 00:05 UTC, junto do export diário (`5 0 * * *`), em invocações separadas. É inofensivo: o claim (`UPDATE ... RETURNING`) é atômico e não entrega o mesmo item a dois drenos enquanto o lease de 5 min está válido, o reprocesso é idempotente, e sem pendência o dreno custa 1–2 consultas ao D1; ele não toca o que o export lê. O minuto 15 segue livre para a descoberta (`15 6 * * *`).
- O minuto 45 segue sem execução, como na PR #769.
- Transição: a Cloudflare propaga a troca de triggers em até 15 min, e nesse intervalo o Worker novo ainda pode receber o agendamento antigo do poller (`0,30 * * * *`). `LEGACY_RESULT_POLLER_CRON` fica no handler como alias que roda só o poller, para o tick não virar `scheduled_unknown_cron`; ela não está no `wrangler.toml` nem em `SCHEDULED_CRONS` e pode sair numa limpeza posterior ao deploy.
- Não há mais `PROVIDER_WORK_DRAIN_CRON` nem `RESULT_POLLER_CRON`: o trigger fundido é uma constante só, e `RESULT_POLLER_MINUTES` e `PROVIDER_WORK_DRAIN_MINUTES` dizem quem roda em cada minuto.

**Regra para agendar algo novo.** A API tem no máximo 4 triggers (5 do plano Free menos 1 que a conta usa em outro Worker). Novo agendamento entra como minuto novo do trigger fundido ou de um existente, não como cron novo. Os testes `wrangler-config.test.ts` e `index.test.ts` travam o total em 4, comparam `crons.ts` com o `wrangler.toml` e cobrem o roteamento por minuto. Se a conta migrar para o plano Paid, o limite deixa de valer e o drenador pode voltar a ter trigger próprio.

### Adendo (2026-11-17): subrequests do dreno

**Problema.** A conta é Free: no máximo 50 subrequests por invocação, e subrequest é todo `fetch` e toda consulta ou batch ao D1 (ADR-024). O dreno limitava itens (`DRAIN_MAX_ITEMS = 16` × `DRAIN_MAX_CYCLES = 4`), não subrequests. Medido na `main` (3d6ca061) com o `scheduled` inteiro, a limpeza de segurança e um D1 que recusa a chamada 51: 16 itens `result` com respostas normais tentaram 63 chamadas no primeiro tick, as gravações de conclusão falharam depois da 50ª, e os 16 itens ficaram `running` até o lease de 5 min vencer. Com o orçamento do minuto cheio, o mesmo dreno gastava 34 chamadas (1 reclamação, 16 × reserva recusada e `requeue`, 1 reclamação vazia); uma leitura a mais por item já leva esse cenário a 50. A ESPN também drena no mesmo tick, em `Promise.all`, então o limite é um só para todos.

**Regra: subrequests do dreno.**
- O ramo drenador do `scheduled` gasta no máximo 45 subrequests (`DRAIN_CALL_BUDGET`, `api/src/matches/drainBudget.ts`). As 5 restantes cobrem a limpeza de registros expirados do mesmo `scheduled` e 4 de folga, como no poller (`POLLER_CALL_BUDGET`). Todo o D1 do ramo passa por contagem, e cada `fetch` é cobrado antes de sair, retry de 429 incluído. Nada depende de a chamada 46 falhar.
- Um coordenador (`runProviderDrains`, `drainCoordinator.ts`) recebe a lista de drenos (`ProviderDrain`), reparte o saldo em fatias que somam no máximo 45 (com dois drenos, 23 e 22), roda os drenos juntos e entrega a sobra de quem terminou cedo numa rodada extra (até 3 rodadas) aos que pararam por saldo e ainda têm fatia útil (`minCalls`). Cada dreno só enxerga a fatia (`DrainBudget`), então o total fica garantido sem estado compartilhado. A ESPN entra com um `ProviderDrain` a mais na lista do `scheduled`. Com a ESPN na lista a repartição passa a ser pela fila de cada dreno, e não mais por igual (adendo do ticket 03, "repartição pela fila"): os 23 e 22 acima valem para drenos sem fila conhecida.
- Dentro da fatia, o ciclo reclama os itens (1 chamada) e grava o estado de todos num único `db.batch()` (concluído, devolvido ou liberado). Para essa gravação ser recuperável, o ciclo reserva 3 chamadas desde o início (`STATE_RESERVE_CALLS`): o batch, uma nova tentativa dele e uma liberação mínima. O custo fixo do ciclo é 4 (`CYCLE_FIXED_CALLS`), das quais o ciclo sem falha gasta 2. O trabalho dos itens nunca toca a reserva, então nenhum item fica `running` por falta de saldo, e a reclamação traz só o que a fatia comporta (`(saldo − 4) / custo do item mais barato`).
- Se o `db.batch()` do estado falha, o dreno espera 250 ms e o repete, uma vez. Se falha de novo, um único `UPDATE` devolve os itens do ciclo a `pending`, sem tentativa nova e sem lease (`DrainRun.settleError`): o que o ciclo tinha concluído roda de novo, e o upsert é idempotente. O dreno para nesse ponto, e `provider_work_run` sai como `error`. **Limite da garantia:** com o D1 indisponível de forma persistente, que recusa também a liberação, o erro sobe, o coordenador o registra, e os itens ficam `running` até o lease de 5 min vencer. O dreno seguinte os reclama, e a tentativa não é gasta a mais, porque só a gravação de `retry` a incrementa.
- Os itens reclamados voltam ordenados por prioridade, `created_at` e `rowid`. O `ORDER BY` do claim só escolhe quais itens reclamar, e a ordem das linhas do `UPDATE … RETURNING` não é garantida; sem a ordenação, uma descoberta inserida antes de um resultado passava à frente dele na admissão por custo.
- Cada item é admitido pela estimativa de custo, que fica reservada até ele terminar. Sem saldo livre, o item espera um em voo terminar e devolver a reserva que não gastou; sem nenhum em voo, o dreno encerra. O que foi reclamado e não começou volta a `pending` sem tentativa nova, sem lease e com o prazo que tinha. O maior custo real visto num item concluído da classe sobe a estimativa dos seguintes, e a estimativa estática é o piso: um item barato, com poucos jogos, não diz que o próximo também será, e uma estimativa baixa causaria interrupção e repetição parcial à toa.
- O D1 e o `fetch` de cada item recusam, sem chamar, o que invadiria a reserva da gravação do estado (`CallBudgetExhaustedError`). O item volta sem tentativa nova; falta de saldo não é falha do provedor.
- Sem vaga no orçamento por minuto da football-data, ou com pausa de cota, o provedor inteiro recusa: o dreno encerra sem tentar os demais itens, que só gastariam uma reserva recusada cada um.
- O sync recebe o saldo (`SyncOptions.callGate`). Cobra cada `fetch` depois de reservar a vaga e antes de sair, e só reserva a vaga se couberem a reserva e o `fetch`. Depois da resposta, só começa a gravar o calendário se o saldo cobre a gravação inteira (`syncWriteCalls`: 6 chamadas para uma rodada, 9 para uma temporada de 380 jogos), em vez de ser cortado no meio. A pontuação do sync manual e da descoberta (e, desde o adendo do ticket 09, a do resultado e da varredura) usa o que sobra ao item (`scoreUnprocessedMatches(…, maxCalls)`), e a descoberta guarda 1 chamada para avançar o status. Pontuação que não termina devolve o item a `pending` sem tentativa, e o dreno seguinte repete o sync, barato e idempotente, e retoma de onde parou; o status só avança quando termina. Se o saldo acaba justamente no avanço do status, `advanceCompetitionStatus` relança o erro de orçamento, em vez de registrar `competition_status_error`, e o item volta sem tentativa pelo mesmo caminho.
- Sem a reclamação vazia no fim (o ciclo só continua quando a reclamação veio cheia) e com o estado de N itens num batch só, em vez de uma gravação por item.
- A telemetria do coordenador não derruba o isolamento de falhas: o registro do erro de um dreno (`tryLogError`) e a linha `[perf]` não lançam, então um Analytics Engine que falha não faz o coordenador perder o gasto dos outros drenos nem as rodadas que reaproveitam a sobra.

**Custo por item, medido** (`fdWork.test.ts`, sync real sobre o SQLite das migrations) e estimativa do dreno, em chamadas:

| Item | Medido | Estimativa |
| --- | --- | --- |
| `result`/`late`, rodada numérica (10 jogos, 20 times), com a pontuação | 10 (7 do sync e 3 da pontuação) | 12 |
| `result`/`late`, temporada (mata-mata, 380 jogos já pontuados) | 11 (10 do sync e 1 da pontuação) | 15 |
| `manual`, rodada, com jogos a pontuar | 10 | 12 |
| `discovery`, temporada de 380 jogos | 13 | 17 |

A estimativa soma a reserva de vaga e o `fetch` (2), a gravação (`syncWriteCalls`, com competição já criada e reabertura de ida), o mínimo para a pontuação planejar e gravar uma vez (`MIN_SCORING_CALLS`) e, na descoberta, o avanço do status. Até o adendo do ticket 09 o resultado e a varredura não pontuavam no dreno e custavam 7 medidas e 8 estimadas numa rodada (10 e 11 na temporada). Um 429 com retry soma 3 (gravar o bloqueio, reservar de novo e novo `fetch`) e fica fora: se o saldo não cobrir, o item volta sem tentativa. O teste falha se o custo real passar da estimativa.

**Consequências.**
- Com 45 chamadas, um tick drenava cerca de 5 itens de rodada (os 16 itens do teste terminavam em 4 ticks), abaixo dos 8 requests por minuto da football-data: o saldo de subrequests passa a ser o limite mais apertado do dreno. Os 5 itens valiam com a football-data sozinha na fila: com a ESPN na lista o coordenador gasta 1 chamada contando a fila de cada dreno e a football-data fica com 44 (`(44 − 4) / 8 = 5` do mesmo jeito, 39 chamadas com a limpeza); com os dois drenos ocupados eram 2 itens de cada (38 chamadas). Desde o adendo do ticket 09 o item de rodada pontua e reserva 12: 3 itens por tick com a football-data sozinha (40 chamadas com a limpeza; os 16 itens terminam em 6 ticks de dreno) e 1 com os dois drenos ocupados.
- Uma competição com muitos palpites pontua em ticks sucessivos da descoberta, e o poller também pontua pelo índice dos jogos sem `scored_at`.
- Com três ou mais drenos a fatia cai abaixo do custo do item mais caro; a repartição precisaria de rodízio. Hoje são um (football-data) e, com a ESPN, dois.
- A reserva de 3 chamadas por ciclo reduz o saldo de trabalho de uma fatia, mas não o número de itens por tick: com 45 (44 depois da sondagem do ticket 03), a reclamação comportava 5 itens de rodada, como antes (3 desde o adendo do ticket 09, com a pontuação no item).
- O teto de 45 vale também na recuperação: tentativa, nova tentativa e liberação cabem na reserva e são contadas na fatia. A garantia de não deixar item `running` vale enquanto o D1 aceita ao menos uma escrita; a indisponibilidade persistente é o limite declarado acima.
- O item de descoberta pode gastar tudo o que sobra ao item na pontuação. Isso só tira saldo de itens que ainda não começaram, e a descoberta tem a menor prioridade da fila.
- `provider_work_run` ganha `double6` (itens devolvidos sem tentativa) e `double7` (subrequests gastos pelo dreno); ver `docs/observability.md`. O coordenador registra uma linha `[perf]` por invocação com o total gasto.
- Reversão: reverter os commits. Não há migration nem cron novo (continuam 4 triggers), e os itens `pending` que o dreno devolve têm o mesmo formato que o dreno anterior lê.

### Adendo (2026-11-17): coordenação da ESPN (ticket 03 da resiliência)

**Problema.** A ESPN seguia com teto de syncs em voo e pacing de 1,3 s por isolate, sem estado compartilhado. Duas execuções sobrepostas somavam requests sem que nenhuma enxergasse a outra; um 403 do Akamai não bloqueava ninguém além do isolate que o recebeu e as próximas execuções insistiam; uma data que falhava no meio de um sync de várias datas perdia as seguintes até o tick ou a descoberta seguinte, e o trabalho não sobrevivia à janela de resgate de 24 h. Uma resposta 200 sem a lista `events` era lida como "sem jogos".

**Decisão.** A ESPN passa a usar as duas tabelas do ADR-027, sem cron novo (o plano Free comporta 4 triggers para a API: ver o adendo do erro 10072):

- **Orçamento e acesso na linha `espn` de `provider_rate_state`** (migration 0047, que só acrescenta colunas com padrão e a linha). `reserveProviderSlot` generaliza a reserva por provedor: `ESPN_CALLS_PER_MINUTE = 40`, abaixo dos ~46/min que o pacing do cliente já impõe. O gate (`createEspnGate`, `matches/espnAccess.ts`) liga o cliente HTTP ao D1 e registra cada resposta num único `UPDATE`, com um `Date.now()` por resposta: **429** pausa pelo `Retry-After` que o fornecedor impôs, sem encurtá-lo (o bloqueio é o maior entre o `Retry-After` válido e 60 s; sem cabeçalho ou com cabeçalho inválido, 60 s), e só um `Retry-After` absurdo (acima de 24 h) suspende a coleta para análise, com alerta, como o 401 e o 451; **403** espaça a coleta em 15 min, 1 h e 6 h e o 4º seguido a **suspende** (a última resposta, na ordem em que o D1 as grava, vence: um sucesso depois de um 403 zera a sequência por um `UPDATE` atômico, sem depender do que a reserva viu, e um 403 depois de um sucesso conta 1); **401 e 451** suspendem na hora. Cada passo emite `provider_access_blocked`. Se o D1 não aceita a gravação de uma proibição, o isolate mantém um bloqueio local em memória e nenhuma reserva passa (nem as chamadas já enfileiradas no mutex do cliente) até a gravação dar certo, regravada a cada reserva; um bloqueio por prazo também cai quando o prazo vence, e uma suspensão não. Suspensa, nenhuma chamada sai e só o operador retoma (`resumeProviderAccess`; runbook em `docs/observability.md`), porque insistir num acesso que a resposta proibiu desrespeita a decisão do provedor. Nada contorna o bloqueio: sem troca de IP, de user-agent nem de caminho.
- **Fila por data.** Um item `provider_work` da ESPN é uma data do scoreboard (`round = YYYYMMDD`; vazio busca a rodada corrente). Um sync de várias datas grava as que chegaram e adia a que falhou e as seguintes. Recusa do orçamento, bloqueio ou suspensão devolvem o item sem gastar tentativa (o provedor não foi chamado ou proibiu o acesso); timeout, 5xx e resposta incompleta gastam tentativa, até o teto de 6, e o produtor revive o item no tick seguinte.
- **Mesmo coordenador, mesmos minutos, um orçamento só.** `espnDrain` (`matches/espnWork.ts`) é uma entrada a mais na lista que o `scheduled` passa a `runProviderDrains` (`index.ts`), ao lado de `footballDataDrain`: mesmo trigger e mesmos minutos (5, 10, 20, 25, 35, 40, 50 e 55), sem cron novo e **sem segundo orçamento de subrequests**. O dreno roda na fatia que o coordenador entrega (os 45 do ramo repartidos entre os drenos pela fila de cada um, ver "Repartição pela fila") e conta nela todo D1 e todo `fetch`. Cada tentativa à ESPN paga do saldo a vaga (1), o `fetch` (1, cobrado antes de sair, retry de 5xx incluído) e o registro da resposta (1); a tentativa só começa se as três cabem, porque um 403 ou 429 que ficasse sem registro deixaria as outras execuções insistirem. O sync só grava a data se o saldo cobre a gravação inteira (`espnWriteCalls`), e sem saldo o item volta a `pending` sem tentativa. Com a coleta bloqueada ou suspensa e itens pendentes, a reclamação recusa e o dreno lê o estado de acesso para dizer o motivo (2 chamadas, nenhuma escrita); sem itens pendentes o coordenador nem o chama.
- **Repartição pela fila.** Com a ESPN na lista, a repartição por igual da #771 deixava a football-data com 4 itens por tick mesmo com a ESPN sem trabalho (a fatia de 23 comportava 2 itens, a sobra da ESPN entrava numa segunda rodada que pagava de novo o custo fixo do ciclo e 11 chamadas sobravam abaixo do mínimo para outra). O coordenador agora conta o trabalho pronto dos drenos que consomem a fila `provider_work` numa consulta só (`countReadyWork`, 1 chamada dos 45), o dreno sem nada pronto não roda e o que pede menos que a fatia justa recebe o que pede, com o resto indo a quem quer mais (`shareBudget`). A ESPN bloqueada ou suspensa com itens ainda roda, com a fatia mínima, para registrar o motivo. Falha da consulta divide por igual, como antes, e um dreno só dispensa a consulta. Com a ESPN ociosa a football-data volta a concluir 5 itens por tick (39 chamadas com a limpeza, uma a mais que as 38 da #771: a sondagem); desde o adendo do ticket 09, que soma a pontuação ao item, 3 itens e 40 chamadas.
- **Poller: o orçamento de 45 vale para a football-data e a ESPN juntas.** O saldo das sincronizações do tick é fixado antes de qualquer uma começar: `POLLER_CALL_BUDGET` (45) menos o que já foi gasto (a leitura dos jogos) e menos a reserva da pontuação (5: a leitura das pendências e o mínimo de uma competição). As rodadas da football-data reservam o custo do sync delas primeiro (`footballDataSyncCost`: 8 por rodada; adendo do ticket 09, abaixo), e a ESPN fica com o que sobra. Cada tarefa da ESPN (uma competição, 2 a 4 datas) é admitida pelo custo completo antes de começar (`espnSyncCost`: 3 chamadas por data e 6 da gravação, 12 para 2 datas e 16 para 3), pela mesma fatia do dreno (`DrainBudget` com a reserva de 1 chamada), e o `fetch` é cobrado pelo porteiro, não pelo observador, para não contar duas vezes. A tarefa que não cabe nem começa: as datas dela vão para a fila durável por data, com `not_before` igual ao instante, sem tentativa gasta e sem erro de provedor (`CallBudgetExhaustedError` não vira `football_api_error`), e ficam elegíveis para o próximo dreno. O enfileiramento do que não coube ou não veio (1 `db.batch()`, que reúne as datas de todas as tarefas) está reservado do saldo antes de qualquer tarefa começar. O saldo que acaba no meio de uma tarefa (a segunda data não cabe, ou a gravação não cabe) devolve as datas restantes à fila do mesmo jeito. O fallback da ESPN para as competições da football-data também fica no saldo, com o que sobra além da reserva da pontuação, e cada competição reserva o custo completo antes de começar (adendo do ticket 09): sem saldo ela espera o tick seguinte, sem erro nem fila (o D1 o replaneja).
- **Identidade e ausência.** O upsert segue a chave `(external_id, provider)` e nada do que o gate faz toca `matches.id`. Resposta 200 sem `events` é incompleta e falha o item (`EspnIncompleteResponseError`). Lista vazia é válida, mas não confirma resultado: a ESPN não tem detecção de "ausente do calendário", e nenhuma partida termina, é cancelada ou marcada ausente por falta de evento.
- **Consumidores.** Coordenados (reservam vaga por request e respeitam bloqueio e suspensão): poller, fallback de resultados da football-data pela ESPN, `POST /matches/sync` de competição ESPN (responde `{ ok, pending: true, pendingDates }` e adia as datas) e o dreno. A descoberta diária também está coordenada, conforme o adendo de orçamento da descoberta abaixo. **Não integrados, por decisão:** o radar (`radar-sync.yml`, GitHub Actions, ~40 slugs por dia, sem acesso ao D1 na coleta e com IPs do GitHub, não do Worker) e scripts locais. Integrar o radar exigiria reserva por uma rota HTTP autenticada do Worker ou migrar a coleta para o Worker; o custo não se paga para ~40 requests/dia já com pacing e uma falha por slug que só marca a execução como parcial. Pendência registrada, a revisitar se o radar passar a levar 403.
- **Histórico da descoberta diária, substituído pelo adendo de orçamento abaixo.** A descoberta não fazia parte do que o ticket 03 pedia, e o estouro dos 50 subrequests nela já existia na `main` (e na football-data desde a #769), então não ganhou orçamento de invocação, fila nem reserva por request: cada request da ESPN segue custando 1 chamada, como na `main`. O que ela respeita é o controle de acesso: antes de chamar uma competição da ESPN a execução lê o estado do provedor (1 consulta por invocação, só se há competição da ESPN) e, com a coleta suspensa ou com bloqueio vigente, pula a ESPN naquela execução, sem fetch, sem erro de provedor e sem fila (a descoberta seguinte tenta de novo); e uma resposta 401, 403, 429 ou 451 durante a execução é registrada no gate (`createEspnDiscoveryGate`: o mesmo `UPDATE` atômico, o alerta `provider_access_blocked` e o bloqueio local se o D1 não grava), valendo para as demais competições da mesma execução (o gate lembra o bloqueio na memória) e para as outras execuções. Só as respostas de erro escrevem no D1: o sucesso não gasta chamada. A data da ESPN que não chegou falha a competição inteira, como o `fetch` que lançava na `main` (o item de retomada é o da `main`), e a recusa do acesso é pulada, não falha. Custo extra medido pelo `scheduled` real: **1 chamada por invocação** (19 para 20 com 1 competição da ESPN); com a ESPN suspensa, 3 chamadas (a limpeza, a leitura das competições e a leitura do estado) e nenhum `fetch`. A descoberta da football-data é idêntica à da `main`.

  **Diagnóstico anterior ao adendo de orçamento da descoberta:** a descoberta continua sujeita ao limite de 50 subrequests por invocação e sem orçamento. Com 4 competições da ESPN × 9 datas ela já ultrapassava o limite na `main`/#771 (42 e 54 chamadas, números medidos pelo review, não reproduzidos aqui; no meu cenário, com 2 jogos novos por competição, a descoberta de 1, 2 e 4 competições da ESPN pede 19, 36 e 70 chamadas sem limite na `main`, e 20, 37 e 71 com a leitura do estado), então a chamada 51 é recusada, a descoberta rejeita e jogos novos que o D1 ainda não conhece não chegam (não entram no planejamento do poller e o dreno não tem pendência para retomar). Correção sugerida: orçamento de invocação (45 do ramo mais 1 da limpeza do `scheduled`, para a football-data e a ESPN juntas), admissão de cada competição pelo custo completo, enfileiramento reservado de um item `discovery` por competição (football-data) ou por data (ESPN), com o dreno concluindo e avançando o status. Uma primeira versão disso foi escrita e revertida nesta PR; o review achou duas armadilhas que a correção precisa resolver: (1) **`finished` precisa de informação agregada**: o avanço do status pelo dreno não sabe quantos jogos o calendário inteiro descartou por time indefinido (`discardedTbd` soma as nove datas), e assumir que há (`tbdDiscarded = 1`) mantém a competição em `ongoing` para sempre quando a football-data ocupa o saldo todo dia e a manda para a fila; (2) **a data `failed` precisa de recuperação fora do horizonte**: uma data que chega a 6 tentativas deixa de ser retomada, e a descoberta só consulta de ontem a hoje + 7, então um jogo gravado só por ela fica perdido se a data sair do horizonte (7 jogos contra 8 no controle).
- **Poller da football-data sem `callGate`:** a limitação que o review do ticket 03 registrou aqui (o poller chamava o sync da football-data sem porteiro, e a estimativa só limitava o saldo da ESPN) foi resolvida no adendo do ticket 09, abaixo.

**Custo por item, medido** (`espnWork.test.ts`, sync real sobre o SQLite das migrations) e estimativa do dreno, em chamadas:

| Item | Medido | Estimativa |
| --- | --- | --- |
| data sem eventos (a requisição: vaga, `fetch` e registro da resposta) | 3 | 9 (piso da classe) |
| `result`/`late`, data de liga (20 jogos, 40 times) | 9 | 9 |
| `result`/`late`, data de 100 jogos e 100 times (1 batch de cada) | 9 | 9 |
| `manual`/`discovery`, data com jogos a pontuar | 13 | 13 |
| 5xx com retry (a 1ª tentativa: vaga e `fetch`; a 2ª: vaga, `fetch` e registro) | 5 | fora da estimativa |

A estimativa soma a requisição (3), a gravação da data (`espnWriteCalls`: competição, times e jogos, 6 até 100 jogos e 100 times) e, no sync manual e na descoberta, o mínimo para a pontuação (`MIN_SCORING_CALLS`, 4). Um 5xx com retry soma 3 e fica fora, como o 429 da football-data: se o saldo não cobrir a segunda tentativa, o item volta sem tentativa. O teste falha se o custo real passar da estimativa, e a estimativa é o piso (o maior custo real visto na classe só a sobe). O registro do sucesso (`UPDATE … WHERE forbidden_streak != 0`) é 1 chamada por tentativa que dá certo, mesmo sem sequência a zerar, e não grava linha nesse caso.

**Chamadas por tick com os dois drenos** (`drainSubrequestsEspn.test.ts`, `scheduled` real, o D1 recusando a chamada 51, o `fetch` na mesma conta e a limpeza de 1 chamada do `scheduled`), com 16 itens de cada provedor: os dois ocupados, **38 chamadas por tick** (a limpeza, a sondagem, 16 da football-data e 20 da ESPN), 2 itens de cada, e a fila dos dois (32 itens, um `fetch` cada) termina em 8 ticks, sem item `running` nem tentativa gasta. Só a football-data com trabalho: **39 chamadas**, 5 itens (a ESPN ociosa nem roda). Só a ESPN: **40 chamadas**, 4 itens. Orçamento do minuto cheio nos dois: **12**, e nenhum `fetch` sai. ESPN em 403 (um só `fetch` à ESPN, a football-data segue): **41**. ESPN suspensa com itens pendentes: **36** (4 itens da football-data; a ESPN gasta 2, a reclamação recusada e a leitura do estado), e nenhum item dela é reclamado. Desde o adendo do ticket 09 o item de rodada da football-data pontua e reserva 12 (custo real de 10 a 12): os dois ocupados, **34** por tick, 1 item da football-data e 2 da ESPN, e a fila dos dois termina em 11 ticks; só a football-data, **40**, 3 itens; minuto cheio, **11**; ESPN em 403, **33**, 2 itens da football-data; ESPN suspensa, **38**, 3 itens da football-data. Os números da ESPN sozinha não mudam.

**Follow-ups do ticket 02 herdados.** O dono do lease (`lease_owner`) vale como fencing nas transições do batch de estado do dreno: cada `UPDATE` de concluído, devolvido e liberado, e a liberação mínima da recuperação, filtra por `status = 'running' AND lease_owner = <dono que reclamou o item>`. Um dreno cujo lease venceu não fecha nem devolve o item que outro reclamou: o batch devolve `changes = 0` para ele, o item sai das contagens (`DrainRun.leaseLost`) e o log recebe um aviso. Na recuperação (os dois batches falham e a liberação mínima funciona), `released` é o número de linhas que o `UPDATE` da liberação alterou, e os itens que outro dreno já reclamou contam em `leaseLost`. **O fencing protege o estado da fila, não o trabalho:** o que o item já gravou no calendário e o pós-sync que já rodou antes da verificação não se desfazem (os dois são idempotentes). O resultado do dreno atrasado, portanto, não é descartado; só não altera o item. `enqueueProviderWork` e `deferProviderWork` recebem o provedor do item em vez de fixar `football-data`, e o dreno aceita o teto de itens em voo do provedor. A falha de pós-sync no dreno marca a execução como `error` e vai para o log nos dois provedores. A pausa e o bloqueio gravam com um único instante por resposta.

**Consequências.**
- Cada tentativa da ESPN do poller, do fallback, do sync administrativo e do dreno custa 1 escrita a mais no D1 (a reserva), mais a escrita do bloqueio quando há. A descoberta também reserva por request, conforme o adendo abaixo.
- O orçamento é janela fixa de um minuto, como o da football-data. Mudá-lo é alterar `ESPN_CALLS_PER_MINUTE`.
- A prioridade da fila é estrita (resultado, depois varredura e sync manual, depois descoberta) e não há envelhecimento. Com entrada contínua de itens `result` a descoberta e o sync manual da mesma fatia podem esperar enquanto houver resultado pronto, e a ordem não garante ausência de starvation. Na prática `result` só nasce na janela de jogos e some ao concluir; uma descoberta que espera demais aparece como pendência antiga (`now - created_at`) no painel. A limitação fica registrada: envelhecer a prioridade é decisão futura, não desta entrega.
- O número de itens por tick é limitado pelo saldo de subrequests (adendo "subrequests do dreno"), não pelo orçamento por minuto da ESPN: com os dois drenos ocupados a fatia da ESPN (22) comporta 2 itens por tick, com a ESPN sozinha 4, e o que não cabe retoma nos ticks seguintes sem gastar tentativa.
- **O poller e o limite de 50.** Cada request da ESPN passa a custar 3 chamadas (vaga, `fetch` e registro da resposta) em vez de 1, e a primeira versão do adendo só as contava: o poller não recusava nada, e o saldo de 45 só limitava a pontuação, depois dos syncs e do fallback. Medido pelo `scheduled` real (`pollerEspnSubrequests.test.ts`, D1 que recusa a chamada 51, limpeza de 1 chamada incluída), 4 competições da ESPN com 1 jogo na janela (2 datas cada) tentavam **52 chamadas** (a 51 e a 52 recusadas, 4 jogos encerrados sem pontuação), e 4 competições com jogos de hoje e do dia anterior (3 datas) **55**, com o tick rejeitado e nenhuma pendência gravada. A admissão pelo custo (decisão acima) resolve: o tick gasta **45** no primeiro caso (3 competições sincronizadas, a 4ª na fila por data) e **43** no segundo (2 sincronizadas, 2 na fila), o dreno conclui o resto em 5 a 10 minutos e o poller seguinte pontua, com o mesmo estado final de um tick sem limite de chamadas.

  | Competições ESPN com 1 jogo na janela (2 datas) | Antes (tentadas) | Depois |
  | --- | --- | --- |
  | 1 | 20 | 20 |
  | 2 | 36 | 36 |
  | 3 | 44 | 44 |
  | 4 | 52 (a 51 e a 52 recusadas) | 45 (3 sincronizadas e 1 na fila) |
  | 4, com jogos de hoje e de ontem (3 datas) | 55 (tick rejeitado) | 43 (2 sincronizadas e 2 na fila) |

  O caso comum, uma competição, não muda: as mesmas 20 chamadas, nada adiado. Com a football-data no mesmo tick (2 rodadas, 3 competições ESPN) o tick gasta 39, com 1 competição ESPN admitida e as outras duas na fila. Só os ticks de contenção mudam, e o que não cabe espera o dreno, não o poller seguinte (30 min). A pontuação das competições adiadas fica para o poller seguinte, como a de todo resultado que o dreno grava (lê as pendências no D1). Limite conhecido: a football-data continua sem recusa no poller (o estimado, 8 por rodada, só reserva o saldo da ESPN), então um `429` com retry (+3 por tarefa) consome a folga de 5 chamadas (limpeza, relatório e 3 de reserva).
- Uma suspensão que ninguém retoma deixa os resultados da ESPN parados sem erro de sync; o alerta `provider_access_blocked` e o `provider_work_run` com `suspended` são o sinal. A retomada depende de decisão do operador sobre os termos de uso.
- Hipóteses não medidas: se o 403 observado em produção é do Akamai por rajada ou por política, e se 15 min / 1 h / 6 h bastam para o bloqueio expirar. A observação pós-implantação, sem carga artificial, é entrega do ticket.
- Testes: `espnAccess.test.ts` (sequência de 403, suspensão, 429 com `Retry-After` preservado e absurdo, respostas entrelaçadas de dois gates, falha da gravação da proibição com o bloqueio local), `espnWork.test.ts` (custo medido por item e o dreno na fatia), `drainSubrequestsEspn.test.ts` (os dois drenos no `scheduled` real sob os 50 subrequests), `espnCoordination.test.ts` (ponta a ponta sobre o SQLite das migrations: execuções concorrentes, bloqueio prolongado até a suspensão e a retomada, 429, falha parcial, timeout, resposta incompleta, data sem eventos, descoberta e fallback), `espnSyncAdmin.test.ts`, `espnMigration.test.ts` e o roteamento do dreno por minuto em `index.test.ts`.

### Adendo (2026-11-17): football-data no orçamento do poller (ticket 09 da resiliência)

**Problema.** O poller chamava o sync da football-data sem porteiro (`callGate`): cada tentativa só era contada, e a estimativa de 8 chamadas por rodada servia apenas para reduzir o saldo da ESPN. Com 6 rodadas na janela, limite compartilhado de 8 requests por minuto e respostas 429 com reset de 60 s, sem competição da ESPN, o `scheduled` tentava 52 chamadas e o tick terminava rejeitado com `D1_ERROR` (o review do ticket 03 contou 10 fetches; o teste deste adendo mede 9). O comportamento já existia na `main` antes da coordenação da ESPN.

**Football-data no saldo do poller.**
- O poller fixa um saldo único para as sincronizações do tick, football-data e ESPN juntas, antes de qualquer uma começar: `POLLER_CALL_BUDGET` (45) menos a leitura dos jogos (1) e a reserva da pontuação (5), 39 num tick com jogo na janela. O saldo usa a mesma fatia do dreno (`DrainBudget`), com 1 chamada reservada desde o início para o enfileiramento do que não coube ou não veio (`SYNC_DEFER_CALLS`): um único `db.batch()` no fim, que reúne as rodadas da football-data e as datas da ESPN.
- Cada rodada da football-data reserva o custo completo do sync antes de qualquer sync, na ordem das tarefas: `footballDataSyncCost`, o sync do item `result` do dreno sem a pontuação (vaga e `fetch`, 2, mais a gravação do calendário, 6 numa rodada e 9 na temporada; 8 e 11 no total). A pontuação fica fora da fatia, na reserva de 5 do fim do tick, como antes. A ESPN admite as tarefas dela ao começar cada uma e só enxerga o que as rodadas admitidas deixaram.
- O sync recebe o porteiro e o D1 do item: o `fetch` é cobrado antes de sair (o observador de telemetria não conta de novo), a vaga só é reservada se couberem ela e o `fetch`, e a gravação do calendário só começa se couber inteira.
- A rodada que não cabe nem começa e vira pendência em `provider_work` (`kind` `result` ou `late`, `not_before` igual ao instante, `last_error` "saldo de chamadas do tick esgotado; a rodada fica elegível para o próximo dreno"), sem tentativa gasta e sem `football_api_error`, e fica elegível para o próximo dreno; quando ele a executa depende da fila e do saldo dele. A rodada cujo saldo acaba no meio (depois de um 429, a gravação já não cabe) volta à fila do mesmo jeito. As demais falhas seguem como antes: viram pendência com o prazo do erro e registram `football_api_error`.
- Um 429 com retry custa 3 chamadas além da estimativa (o bloqueio, a nova vaga e o novo `fetch`), como no dreno. Elas saem do saldo das sincronizações que as outras tarefas admitidas não reservaram, nunca da reserva da pontuação nem da folga de 5 do `scheduled`; se esse saldo não cobre o retry ou a gravação, a rodada volta à fila.
- O fallback da ESPN para as competições da football-data recebe uma fatia própria (`DrainBudget`) com o que as sincronizações deixam além da reserva da pontuação. Cada competição reserva o custo completo antes de começar, `FALLBACK_COMPETITION_CALLS` (11: a consulta dos jogos, 3 datas de 3 chamadas e a gravação; 3 datas é o máximo da janela de 24 h do fallback), e a consulta, as tentativas e a gravação saem pelo D1 e pelo porteiro dela, que recusam sem chamar o que passaria da fatia. A competição que não cabe espera outra terminar e devolver o que reservou e não gastou; sem nenhuma em andamento, espera o tick seguinte, sem erro nem fila. Antes o porteiro só limitava as tentativas HTTP, e a consulta e a gravação de cada competição saíam sem saldo: com 11 competições da football-data no tick, as consultas do fallback esgotavam o limite, e a leitura dos jogos encerrados sem pontuação, no fim do tick, era a chamada 51 da invocação.

**Chamadas por tick, medidas** (`pollerFootballDataSubrequests.test.ts`, `scheduled` real nos minutos 0 e 30, o D1 recusando a chamada 51, o `fetch` na mesma conta e a limpeza de 1 chamada do `scheduled`; o cenário misto é de `pollerEspnSubrequests.test.ts`):

| Tick | Antes (tentadas) | Depois |
| --- | --- | --- |
| 1 rodada | 15 | 15 |
| 2 rodadas | 22 | 22 |
| 2 rodadas, 429 e retry nas duas | 28 | 28 |
| 2 rodadas e 3 competições ESPN | 39 | 39 |
| 6 rodadas, respostas normais | 47 | 38 (4 sincronizadas, 2 na fila, fallback fora do tick) |
| 6 rodadas, 429 com reset de 60 s, 8 requests por minuto | 52, 9 fetches, tick rejeitado com `D1_ERROR` | 45, 8 fetches (3 sincronizadas, 3 na fila) |
| 11 competições com 1 rodada cada, 4 respostas 429 com reset de 1 s, ESPN sem eventos | 58, 9 fetches, tick rejeitado com `D1_ERROR` | 46, 8 fetches (3 sincronizadas, 8 na fila, fallback fora do tick) |

A primeira versão deste adendo, com o fallback ainda fora do saldo, media 45 nas 6 rodadas com respostas normais, 46 nas 6 rodadas com 429 e, nas 11 competições, 51 tentadas: as consultas do fallback, uma por competição, gastavam o que restava, e a leitura dos jogos encerrados sem pontuação, no fim do tick, era recusada com `D1_ERROR`, registrado só no log (o tick saía `ok`, com 8 rodadas na fila). Nas 6 rodadas, a diferença é o fallback, que agora não cabe nas 6 chamadas que sobram.

Nos cenários de 6 rodadas e no das 11 competições, o dreno e os ticks seguintes esvaziam a fila sem tentativa gasta, sem passar de 50 chamadas em nenhum tick, e terminam no estado que a semente define: os jogos encerrados com o placar do provedor e pontuados, os pontos de cada palpite e o ranking de cada grupo. O teste escreve esse estado a partir da semente, sem passar pelo poller, e um tick sem limite de chamadas com 2 rodadas chega a ele.

**Pontuação das rodadas adiadas no dreno.** Na primeira versão deste adendo o dreno só sincronizava o item `result` ou `late`: a rodada adiada ganhava o placar no primeiro dreno (5 min depois do tick), mas os pontos e o ranking só vinham no poller seguinte (30 min), porque só o sync manual e a descoberta pontuavam no pós-sync. Antes deste adendo as 6 rodadas cabiam no tick e eram pontuadas juntas, então isso era um atraso novo na tela.
- O pós-sync de todo item da football-data pontua a competição (`footballDataSyncedHandler` chama `scoreWithinBudget`, o mesmo do sync manual e da descoberta), com o que estiver livre na fatia. Só a descoberta avança o status da competição.
- O item `result`/`late` reserva o sync e o mínimo da pontuação (`footballDataItemCost`: 8 + `MIN_SCORING_CALLS` = 12 numa rodada, 15 na temporada), e o item mais barato do dreno passa de 8 para 12 (`footballDataMinItemCalls`, que dimensiona a reclamação e o `minCalls` do coordenador). O poller continua admitindo a rodada só pelo sync (`footballDataSyncCost`, 8), porque a pontuação do tick tem a reserva própria no fim.
- Pontuação que não termina por saldo segue o caminho que já existia: o item volta a `pending` sem tentativa (`incomplete`), e o dreno seguinte repete o sync, idempotente, e retoma de onde parou; o poller também pontua pelas pendências do D1 (`PENDING_SCORING_SQL`). Falha da pontuação (que não seja de saldo) conclui o item com `football_api_error` `drain_post_sync` e fica para o poller. Pontuar de novo não soma pontos: os pontos de cada palpite e o ranking são regravados por inteiro, e o jogo com `scored_at` não entra de novo.
- Medido pelo `scheduled` real (`pollerFootballDataSubrequests.test.ts`): tick do minuto 0 com 6 rodadas (38 chamadas, 4 sincronizadas e pontuadas, 2 na fila) e só o dreno do minuto 5 depois dele: **24 chamadas** (a limpeza, a sondagem, reclamar, 2 rodadas de 7 do sync e 3 da pontuação e o estado), e o banco termina com o placar, o `scored_at`, os pontos dos palpites e o ranking que a semente define, sem o poller do minuto 30. Sem a pontuação no dreno, o mesmo teste termina com as 20 partidas adiadas com placar e sem pontos, e o ranking em 32 e 120 pontos em vez de 48 e 180. Os ticks do poller não mudam (15, 22, 28, 38, 45 e 46 chamadas nos cenários da tabela acima, e 39 no misto com a ESPN).
- Custo: o dreno conclui menos itens de rodada por tick quando a fila é longa, porque cada um carrega a pontuação. Medido pelo `scheduled` real (`drainSubrequests.test.ts` e `drainSubrequestsEspn.test.ts`, 16 itens de rodada da mesma competição):

| Dreno | Antes (só o sync) | Depois (sync e pontuação) |
| --- | --- | --- |
| Só a football-data com fila | 5 itens, 39 chamadas | 3 itens, 40 chamadas |
| 16 itens da football-data | 4 ticks de dreno | 6 ticks de dreno |
| Football-data e ESPN com fila (16 de cada) | 2 + 2 itens, 38 chamadas, 8 ticks | 1 + 2 itens, 34 chamadas, 11 ticks |
| ESPN em 403 | 41 chamadas | 33 chamadas, 2 itens da football-data |
| ESPN suspensa | 36 chamadas, 4 itens da football-data | 38 chamadas, 3 itens da football-data |
| Orçamento do minuto cheio nos dois | 12 chamadas | 11 chamadas |

Atraso na tela depois do fim do jogo, pelos ticks medidos (dreno nos minutos 5, 10, 20, 25, 35, 40, 50 e 55; poller nos 0 e 30):

| Cenário | Placar | Pontos e ranking |
| --- | --- | --- |
| Até 4 rodadas da football-data no tick | no tick | no tick |
| 5 a 7 rodadas (1 a 3 na fila), fila da ESPN vazia | 1º dreno (5 min) | 1º dreno (5 min); antes desta revisão, o poller seguinte (30 min) |
| 6 rodadas com 429 (3 na fila) | 1º dreno | 1º dreno |
| 11 competições com 1 rodada (8 na fila) | 3 por dreno: 5, 10 e 20 min | com o placar; antes desta revisão, 30 min. Uma das 3 competições sincronizadas no próprio tick, que o fim do tick não teve saldo para pontuar, espera o poller seguinte (30 min), como antes |
| Fila longa nos dois provedores | 1 rodada da football-data por dreno | com o placar |

**Consequências.**
- Um tick do poller sincroniza no máximo 4 rodadas da football-data (38 livres, 8 por rodada) ou 3 temporadas de mata-mata (11 cada), o mesmo número do teto de syncs em voo (`FD_MAX_CONCURRENT_REQUESTS`). O resto fica elegível para o próximo dreno, que o sincroniza e pontua; quando ele o executa depende da fila e do saldo. Esse é o custo da regra: com 6 rodadas e respostas normais, que antes cabiam inteiras no tick (47 chamadas), 2 rodadas passam a esperar o dreno mesmo sem 429, porque a admissão conta o custo estimado, e não o que a resposta vai pedir.
- A rodada que leva 429 e fica sem saldo para gravar já gastou a requisição: o dreno a repete e ocupa mais 1 vaga do orçamento por minuto.
- Num tick apertado o fallback da ESPN não roda: com 6 rodadas sobram 10 chamadas (as 4 rodadas gastam 7 cada, e não as 8 estimadas), menos que as 11 de uma competição. O fallback complementa o resultado e o D1 o replaneja no tick seguinte, e as rodadas que não couberam já estão na fila. A reserva de 11 conta 3 datas, o máximo da janela; o caso comum pede 2 (8 chamadas), e as 3 restantes ficam presas só enquanto a competição roda.
- Com a football-data ocupando o saldo, a ESPN cede como antes, e as datas dela entram no mesmo batch de enfileiramento.
- A falha do enfileiramento sai como `football_api_error` com blob2 `poller_defer` (antes `espn_defer`, só com as datas da ESPN). O log `[perf]` do poller troca `espn_budget` por `sync_budget` e ganha `fd_deferred_rounds`; ver `docs/observability.md`.
- Reversão: reverter o commit. Não há migration nem cron novo, e as pendências gravadas têm o formato que o dreno já lê.


### Adendo da ADR-027: orçamento da descoberta diária

O cron `15 6 * * *` entrega 45 chamadas à descoberta para football-data e ESPN juntas. A limpeza de segurança custa mais 1 chamada, fora desse saldo. O `DrainBudget` reserva desde o início 1 chamada para o batch final e admite cada competição pelo custo completo, antes de começar. A consulta ordena primeiro as competições públicas, depois a quantidade de grupos em ordem decrescente e, no empate, o slug em ordem crescente. A contagem usa o índice de `groups.competition_id` na mesma consulta, sem chamada adicional ao D1. Grupos medem uso já registrado no schema. O provedor não define prioridade; uma ESPN pública com grupos precede uma football-data piloto sem grupos. A admissão percorre essa ordem e enfileira quem não cabe, sem interromper a avaliação das seguintes. A estimativa é 17 por calendário football-data e 42 por calendário ESPN de nove datas. Leituras, reservas, retries, gravações, pontuação e status passam pelo mesmo saldo. Um retry que não cabe é recusado antes do request.

Cada competição football-data que não cabe vira um item `discovery`; cada competição ESPN vira nove itens por data. O batch único grava a fila e a evidência da janela atomicamente. Falta de saldo usa `not_before` do instante da descoberta, zero tentativas e nenhum `football_api_error`. Uma falha parcial da ESPN replaneja as nove datas para obter os descartes agregados, inclusive as já recebidas; os upserts são idempotentes. Falha no batch registra `competition_status_error` por competição e marca a execução como erro, e a descoberta seguinte replaneja as competições ativas.

A migration `0049_discovery_dates.sql` registra as nove datas de cada janela adiada, com `discarded_tbd = NULL` enquanto não há conclusão. O dreno grava os descartes depois de sincronizar e pontuar a data, condicionado ao dono do lease. Reserva três chamadas extras por item de descoberta para gravar essa evidência, consultar a soma e reconciliar o status. A reconciliação usa a soma da janela mais recente somente quando todas as suas nove datas e as janelas anteriores foram concluídas. Assim uma data vazia confirma zero descartes, um time indefinido impede o encerramento e uma final antiga chega a `finished` mesmo quando a descoberta diária inteira fica na fila. Uma descoberta direta também espera itens antigos em `pending`, `running` ou `failed` antes de encerrar a competição.

Itens em `failed` continuam exigindo intervenção depois de seis tentativas. O procedimento em `docs/observability.md` retoma a chave original mesmo fora do horizonte da descoberta, sem mudar a data para hoje. A evidência incompleta impede encerrar silenciosamente uma competição com data perdida.

Medições pelo `worker.scheduled` real, com SQLite das migrations e recusa da chamada 51, constam em `docs/observability.md`. Jogos novos adiados aparecem após os ticks do dreno e são pontuados junto com a sincronização. O caso comum continua produzindo o mesmo estado sem fila; passa a pagar a coordenação compartilhada da ESPN.

Na semente dos testes pelo cron real, 1/2/4 competições ESPN passam de 23/43/56 chamadas tentadas para 41/42/42; nove football-data passam de 58 para 23. Os cenários de 56 e 58 chamadas rejeitavam a execução na base. A final antiga sob quatro football-data custa 24 por descoberta e chega a `finished` depois do dreno, inclusive com três descobertas consecutivas.

Na distribuição de produção de 19/11/2026, com 10 football-data e 4 ESPN ativas e 53 grupos, o cenário com calendários sintéticos admite Brasileirão Série A e Premier League às 06:15 UTC, em 24 chamadas incluindo a limpeza. Adia 44 itens, sendo 8 calendários football-data e 36 datas ESPN. Sem outra carga, a fila termina em 21 ticks, às 08:50 UTC, quando aparece o último jogo novo; as quatro públicas ficam completas às 07:05 UTC. Com um `result` de ontem e um `late` de anteontem da Libertadores replanejados antes de cada um dos três primeiros drenos, termina em 22 ticks às 08:55 UTC, com as públicas completas às 07:10 UTC. Nenhum dreno ultrapassa 35 chamadas. Ambos os estados finais têm 46 jogos e são iguais ao controle sem limite. Os horários descrevem essa carga finita; entrada contínua prioritária pode prolongar a espera.

## ADR-028: Link público de pedido de entrada no grupo

**Status:** Accepted
**Date:** 2026-11-18

### Context

Só o dono via o código de convite. Membros que compartilham cartões de marco não podiam trazer amigos sem expor o código. Um link estável, separado do convite, permite pedido de entrada com aprovação do dono.

### Decision

- Cada grupo tem `public_id` (32 hex aleatórios), gerado na criação e no backfill da migration. Trocar `invite_code` não altera o `public_id`. O `public_id` é visível para todo membro do grupo (o código de convite continua só com o dono).
- `join_requests_enabled` (default ligado) deixa o dono desligar novos pedidos sem invalidar o link. Com pedidos desligados, `POST /groups/join-requests` responde 403.
- Pedidos ficam em `group_join_requests` (pending/approved/rejected). Um pendente por usuário e grupo; limite diário por usuário; cooldown após recusa. Recusar não bane.
- A prévia pública (`GET /public/groups/:publicId`) mostra só nome, campeonato e número de membros, sem nomes nem código de convite.
- Aprovação reutiliza a inserção de membro do convite e grava no servidor `group_joined` com `entry_method = request`. No navegador do dono, a aprovação dispara `approve_join_request` (sem dado pessoal). Quem pede dispara `join_request`.
- O cliente não pode mandar `entry_method=request` em `POST /groups/join`; esse valor só nasce na aprovação.
- A migration 0051 inclui o trigger `groups_public_id_insert` para cobrir INSERTs do Worker antigo entre a migration e o publish. O trigger sai num contract futuro, quando o Worker antigo não estiver mais no ar.

### Consequences

- O link revela existência e tamanho do grupo a quem o possui; não enumera grupos (id não sequencial) e responde 404 genérico para id inválido.
- O relatório por `entry_method` depende da dimensão personalizada de evento `entry_method` no GA4 (o `join_group` já a usa). Eventos personalizados (`join_request`, `approve_join_request`) aparecem sozinhos; registrar como eventos-chave é opcional.

## ADR-029: Placar improvável na competição inteira

**Status:** Accepted
**Date:** 2026-11-19

### Context

O resumo da rodada e o ranking já reconhecem o rei da rodada, a sequência de preenchimento e os marcos de placares exatos no grupo (ADR-021). Falta reconhecer o placar exato que poucos cravaram. Medir a raridade só dentro do grupo falha nos grupos solo (maioria da base). A auditoria de engajamento (ticket 01) e a decisão do operador fixaram a raridade entre todos os palpiteiros distintos da competição no Palpitae, com piso `X = 10%` e `M = 10`.

### Decision

`GET /groups/:id/round-standings` passa a devolver, em cada linha, `unlikely_exact` (boolean). O campo é aditivo; clientes antigos o ignoram. Sem pontos extras, sem ranking global entre grupos e sem percentual nem contagens na resposta (privacidade).

Regra de raridade (Opção B):

1. Só jogos da rodada de referência, `finished` com `scored_at`, placar oficial preenchido.
2. Denominador: `COUNT(DISTINCT user_id)` entre palpites de grupos com `deleted_at IS NULL` na competição do grupo. O mesmo usuário em vários grupos conta uma vez.
3. Numerador: usuários distintos cujo `predicted_home_score`/`predicted_away_score` batem com o placar oficial. Não usa `points_awarded` (regras de grupo diferem).
4. O jogo é raro quando `tipsters >= 10` e `exact_tipsters * 100 <= tipsters * 10`.
5. Só o membro deste grupo com placar exato pontuado (`points_exact > points_winner` e `points_awarded = points_exact`) recebe o reconhecimento.
6. Além do mínimo total, o reconhecimento só vale com pelo menos 10 palpiteiros distintos que não são membros do grupo de quem lê. O mínimo de 10 de fora impede a inferência a partir de um só grupo (cenário 19 conhecidos + 1 privado). Com conhecimento de vários grupos resta uma inferência de um bit (a pessoa de fora cravou ou não o placar); o risco foi aceito porque revela só se um desconhecido acertou o placar de um jogo encerrado e exige conhecer quase todos os outros palpites.
7. Empate no raro: todos que cravaram e passam nos mínimos recebem.

Privacidade: a API e a UI mostram só o texto qualitativo com o limiar público (`no máximo 10%`). Não devolvem o percentual exato do jogo nem as contagens de tipsters. O limiar é público; o número do jogo não é. Contagens ficam só em `unlikely_exacts` / `match_score_rarity` para auditoria interna.

Agregado compartilhado: a tabela `match_score_rarity` (migration `0053`) guarda `(match_id, tipster_count, exact_count, scored_at_snapshot, status)`. O cálculo roda de forma preguiçosa na leitura de `round-standings`. Antes de agregar, a leitura tenta uma reserva `status = 'computing'` com o `scored_at_snapshot` alvo (`INSERT ... ON CONFLICT DO UPDATE` só quando não há linha, o snapshot é outro ou a reserva expirou após 60 s). Só quem obtém `meta.changes > 0` calcula e confirma `status = 'ready'`; quem perde a disputa segue sem o reconhecimento daquele jogo nesta leitura. A confirmação exige que o snapshot calculado ainda seja o `scored_at` atual em `matches`, para uma conclusão atrasada não sobrescrever um snapshot mais novo. Preferimos a leitura ao fim da pontuação em `scoring.ts` porque o tick do poller já opera no orçamento de subrequests da ADR-027. Exclusão de grupo ou usuário pode deixar o agregado defasado até a próxima repontuação do jogo (`scored_at` novo); isso é aceitável.

Estabilidade: a tabela `unlikely_exacts` grava `(group_id, user_id, match_id)` na primeira observação, com `round`, `tipster_count`, `exact_tipster_count`, `outside_tipster_count` e o placar. A chave primária com `ON CONFLICT DO NOTHING` impede redisparo. O selo da rodada sai das linhas cuja `round` é a referência. Correção de placar ou repontuação não apaga a linha nem cria outra na rodada seguinte. Falha de gravação é registrada e o GET responde com o que já está no banco.

Custo: cada leitura do grupo lê os agregados dos jogos da rodada de referência (≤ número de jogos) e os palpites do próprio grupo. Leituras concorrentes disputam a reserva por jogo e snapshot; o cálculo completo dos palpites da competição roda uma vez por reserva obtida (e de novo se a reserva expirar sem confirmação). Medição em D1/Miniflare com 50 grupos × 20 palpiteiros × 10 jogos: consulta legada 30 224 `rows_read` por abertura; 1ª leitura com reserva e cálculo 21 072; reuso 877. Plano de consulta em `unlikelyExacts.queryPlan.test.ts`; medição em `unlikelyExacts.rowsRead.test.ts`.

Na web, o ranking mostra o selo `improvável` (`title` + SR) só para quem tem `unlikely_exact` na referência. O resumo e o cartão compartilhável usam o texto qualitativo; o cartão leva o link de convite (dono) ou o link público de pedido de entrada (membro), com `share_invite` em contexto `unlikely_exact`. Grupo solo recebe o selo quando a competição tem massa e há ≥ 10 tipsters fora do grupo. Mata-mata sem rodada de referência devolve `{ round: null, standings: [] }` e não inventa selo.

### Consequences

- Com a base atual do Brasileirão (mediana ~5 palpiteiros/jogo), o selo quase não dispara até a competição passar de 10 palpiteiros distintos por jogo e de 10 fora do grupo; na Copa do Mundo a massa já basta.
- Sem percentual nem contagens na resposta, um membro não deduz o palpite de um tipster privado a partir do número exibido.
- O SQL só considera jogos da rodada de referência atual. O reconhecimento é gravado na primeira leitura do grupo nessa referência. Se a referência avançar antes de qualquer abertura, aquele placar raro não gera selo na rodada seguinte (o código não projeta reconhecimento para a referência futura). Preferimos documentar esse comportamento a acrescentar backfill por rodadas anteriores.
- Exclusão de grupo/usuário pode alterar o agregado real sem invalidar `match_score_rarity` até a próxima repontuação; risco aceito.
- As tabelas saem em cascata com exclusão de conta, grupo ou jogo.

---

## ADR-030: Colheita de decisões dos comentários (2026-11)

**Status:** Accepted
**Date:** 2026-11-21

### Context

A passagem de limpeza de comentários em `api/` classificou decisões não óbvias que viviam só no código. Várias já estavam em ADRs anteriores; o restante foi colhido aqui para o comentário poder sair do fonte. Itens já cobertos por ADR-001–029 aparecem só como ponteiro; o detalhe continua na ADR original.

### Decision

Registrar abaixo as decisões colhidas. Comentários correspondentes saem do código nesta passagem. Passagens futuras da skill `delete-comment` acrescentam adendos ou ADRs novas, sem reintroduzir o comentário.

#### Já cobertas por ADRs existentes

- **Formato de matches imposto por gatilhos** — já documentada; origem `api/migrations/0043_matches_format_triggers.sql:1`.
- **Orçamento compartilhado e fila durável de provedores (ADR-027)** — já documentada; origem `api/migrations/0046_provider_coordination.sql:1`.
- **Coordenação da ESPN no orçamento e controle de acesso 403** — já documentada; origem `api/migrations/0047_espn_coordination.sql:1`.
- **Link público de grupo e pedidos de entrada (expand/contract)** — já documentada; origem `api/migrations/0051_group_join_requests.sql:1`.
- **Marcos de placares exatos por membro e grupo** — já documentada; origem `api/migrations/0052_exact_milestones.sql:1`.
- **Raridade de placares exatos por jogo compartilhada** — já documentada; origem `api/migrations/0053_unlikely_exacts.sql:1`.
- **Coleta do radar fora do Worker (script gera SQL + wrangler)** — já documentada; origem `api/scripts/radarSync.ts:1`.
- **Minutos 0 e 30 só do poller; alerta de resultado atrasado** — já documentada; origem `api/src/index.ts:178`.
- **Drenadores da fila durável dividem orçamento de subrequests** — já documentada; origem `api/src/index.ts:192`.
- **Controle de acesso da ESPN por status HTTP (403 espaçado, suspensão)** — já documentada; origem `api/src/matches/espnAccess.ts:7`.
- **Fallback de resultados via ESPN (ADR-016)** — já documentada; origem `api/src/matches/espnFallback.ts:23`.
- **Adiado em state post mantém palpite aberto (ADR-013)** — já documentada; origem `api/src/matches/espnSync.ts:174`.
- **Regra única de travamento de palpite (ADR-004)** — já documentada; origem `api/src/matches/locking.ts:1`.
- **Chamadas fora do orçamento do poller (ADR-024)** — já documentada; origem `api/src/matches/poller.ts:169`.
- **Orçamento compartilhado: o que não cabe vira item durável** — já documentada; origem `api/src/matches/poller.ts:724`.
- **Orçamento compartilhado de chamadas à football-data (ADR-027)** — já documentada; origem `api/src/matches/providerBudget.ts:4`.
- **Fila durável provider_work (ADR-027)** — já documentada; origem `api/src/matches/providerWork.ts:8`.
- **Seam de provedor de e-mail transacional (ADR-009)** — já documentada; origem `api/src/notifications/email.ts:1`.
- **Link do lembrete com rodada explícita (ADR-019)** — já documentada; origem `api/src/notifications/reminderEmail.ts:59`.
- **Cliente ESPN: API não oficial, respostas malformadas viram erro (ADR-015)** — já documentada; origem `api/src/providers/espn.ts:1`.
- **Recorte curado ESPN para o radar (ADR-015)** — já documentada; origem `api/src/radar/espnRadar.ts:1`.
- **ends_on do provedor é piso, não data de fim** — já documentada; origem `api/src/radar/router.ts:44`.
- **Coletor SQL nasceu de rate limit por IP** — já documentada; origem `api/src/radar/sqlCollector.ts:1`.
- **Orçamento diário de linhas do D1 por usuário (ADR-022)** — já documentada; origem `api/src/security/limits.ts:51`.
- **Trigger fundido de poller e drenador** — já documentada; origem `api/wrangler.toml:36`.

#### Auth, sessão e OAuth

- **Corte de sessões sessions_valid_after para logout-all** (`api/migrations/0017_sessions_valid_after.sql:1`): Corte de sessões para "Sair de todos os dispositivos". `POST /auth/logout-all` grava aqui o instante atual em segundos Unix (mesma unidade do `iat` do JWT). A verificação de sessão rejeita todo token do usuário com `iat` menor ou igual a esse valor, inclusive o da sessão que pediu a saída. NULL (padrão) significa que nenhum corte foi pedido.
- **Uma única escrita aceita por token (hash de revogação)** (`api/src/auth/jwt.ts:53`): Cada token tem uma única escrita aceita. A revogação do logout guarda o hash do texto do token, e uma segunda escrita da mesma assinatura escaparia dela.
- **/auth/me devolve 200 anônimo por causa do Lighthouse** (`api/src/auth/router.test.ts:413`): Visita anônima é o caso comum (toda visita chama /auth/me). Responder 200 em vez de 401 evita que o navegador logue essa checagem de rotina como erro no console (reprovava Best Practices no Lighthouse).
- **Códigos de erro OAuth conhecidos limitam cardinalidade** (`api/src/auth/router.ts:30`): Conjunto conhecido de códigos de erro do Google OAuth. Limita a cardinalidade do evento oauth_error — o parâmetro `error` do callback é público e arbitrário.
- **Cookie de origem sempre gravado** (`api/src/auth/router.ts:132`): Sempre grava, mesmo vazio: sem isso, a origem de uma tentativa anterior valeria nesta. Só token reconhecido entra no cookie; o callback valida de novo.
- **Cookie de destino sempre gravado** (`api/src/auth/router.ts:138`): Também sempre grava: login sem destino, ou com destino recusado, não pode levar ao destino de uma tentativa anterior que não chegou ao callback.
- **logout-all grava corte em sessions_valid_after** (`api/src/auth/router.ts:240`): POST /auth/logout-all — encerra todas as sessões do usuário, inclusive esta. Grava o corte em `users.sessions_valid_after`; a verificação de sessão rejeita tokens emitidos até esse instante. Se o D1 falhar, o cookie fica no navegador para o usuário tentar de novo, porque as outras sessões continuam válidas.
- **/auth/me sem requireAuth** (`api/src/auth/router.ts:266`): GET /auth/me — return authenticated user Não usa `requireAuth`: essa rota é chamada em toda visita (inclusive anônima) só para checar se há sessão. Um 401 aqui é o estado normal de "deslogado" — não um erro — mas o Chrome loga qualquer resposta 4xx/5xx de fetch/XHR como erro no console, o que reprovava a auditoria de Best Practices do Lighthouse. Retornar 200 com `{ authenticated: false }` resolve isso sem mudar o co…
- **Sync manual restrito ao admin, fechado por padrão** (`api/src/matches/router.ts:406`): Ferramenta manual de seed e backfill, restrita ao admin. A atualização normal de partidas roda pelos cron triggers (discoverFixtures / pollActiveMatches). Mesmo critério dos outros painéis de admin (ver auth/permissions.ts). Sem ADMIN_EMAIL configurado, responde 403, então a rota fica fechada por padrão. O gate roda antes de ler o corpo.
- **GET de descadastro não muda estado** (`api/src/notifications/router.ts:92`): GET /notifications/unsubscribe?token=... Public — opened from the e-mail footer link. Renders a confirmation form; does NOT mutate state. E-mail scanners (Microsoft Safe Links, antivirus proxies) fire GET on every link in a delivered e-mail — a mutating GET would unsubscribe users without their knowledge. Only the POST below actually writes to the database.
- **Token de descadastro próprio, não JWT** (`api/src/notifications/unsubscribeToken.ts:1`): Token próprio e sem estado para o link de descadastro de um clique nos e-mails. De propósito, não é um JWT: o middleware de autenticação (`requireAuth`) aceita qualquer JWT HS256 assinado com o JWT_SECRET, então reaproveitar o token de sessão aqui transformaria a URL de descadastro, que viaja dentro de todo e-mail, em credencial de sessão. Este token leva só o id do usuário e um HMAC separado: serve para agir sobre o…
- **Dashboard de métricas como proxy autenticado da SQL API do AE** (`api/src/observability/metricsRouter.ts:17`): Métricas para o dashboard admin — proxy autenticado da SQL API do Analytics Engine + listagem do arquivo frio (R2). Ver `docs/observability.md`. Por que um proxy: a SQL API exige um token de CONTA Cloudflare (Account Analytics:Read), que nunca pode ir pro cliente. O token fica em secret do Worker; o navegador autentica com o cookie de sessão normal. Acesso: só o admin (e-mail em ADMIN_EMAIL, secret, e o `sub` do Goog…
- **Rotas públicas devolvem o mínimo para anônimos** (`api/src/public/router.ts:8`): Rotas públicas (sem `requireAuth`). Cada uma devolve o mínimo necessário para um visitante anônimo ou um crawler; nada aqui pode expor dado de usuário.
- **Rotas que nunca recusam por orçamento diário** (`api/src/security/limits.ts:61`): Rotas que nunca recusam por orçamento diário. Sair da conta tem de funcionar mesmo depois que um token roubado gastou o dia inteiro.

#### Cache e listagem de jogos

- **Índice de scored_at para versão do cache de GET /matches** (`api/migrations/0042_matches_scored_index.sql:1`): Versão do cache de borda de GET /matches. Antes de consultar o cache, a rota lê a visibilidade da competição e o MAX(scored_at) dos jogos dela, que entra na chave: um placar corrigido e repontuado muda a chave e a lista sai do cache longo. Com este índice o MAX lê uma entrada do índice. Sem ele, cada requisição servida pelo cache leria todos os jogos da competição (~380 numa liga de 20 times). Parcial: só uma query c…
- **matches_version e repontuação por contexto** (`api/migrations/0044_matches_version.sql:1`): Versão da lista de jogos, recusa de times iguais e repontuação por contexto. `competitions.matches_version` sobe na mesma transação de cada alteração que a lista de `GET /matches` exibe, e a chave do cache de borda passa a usá-la no lugar do MAX(scored_at). Os gatilhos `matches_distinct_teams_*` recusam time igual nos dois lados do confronto. O `matches_rescore_context` devolve à fila de pontuação os jogos de mata-ma…
- **Gravação do estado do ciclo em batch com fencing** (`api/src/matches/providerWork.ts:726`): Grava o estado do ciclo num `db.batch()`, com o fencing por dono do lease em cada instrução (`leaseFence`): o item que outro dreno reclamou depois do vencimento do lease não é tocado, e o resultado do batch o aponta (`cycle.lost`). O fencing protege o estado da fila; o que o item já gravou no calendário e o pós-sync que já rodou antes da gravação não se desfazem. Se o D1 falhar, repete uma vez; se falhar de novo, ten…
- **Cache-Control do navegador sempre em TTL curto** (`api/src/matches/router.ts:39`): Cache-Control da resposta ao navegador. O cache do navegador não muda de chave quando um placar é corrigido nem quando a competição volta a ser piloto, então ele fica sempre no TTL curto. A revalidação cai no cache de borda. `private` deixa a resposta só no navegador. A cópia da borda é a única compartilhada.
- **Cache de borda best-effort por colo** (`api/src/matches/router.ts:77`): Cache de borda (Cache API), compartilhado entre os usuários do mesmo colo da Cloudflare, sem custo extra. É best-effort: vale por colo e pode ser despejado. Um hit poupa as consultas da lista e as linhas lidas. Fora do runtime dos Workers (testes em node) `caches` não existe. `caches.default` é extensão da Cloudflare, por isso o cast sobre o tipo `CacheStorage` do lib.dom. Piloto nunca entra no cache compartilhado.
- **Desempate por rowid na lista de jogos** (`api/src/matches/router.ts:165`): m.rowid desempata jogos no mesmo horário pela ordem de inserção. Sem ele a ordem dos empates dependeria do índice que o planner escolhe.
- **Visibilidade checada antes do cache de borda** (`api/src/matches/router.ts:305`): Visibilidade antes do cache: uma competição que voltou a ser piloto não é servida por uma lista guardada quando ainda era pública.
- **Só listas não vazias entram no cache de borda** (`api/src/matches/router.ts:349`): Só cacheia listas não-vazias. Isso (a) evita servir um snapshot vazio de uma competição que ainda vai ser sincronizada e (b) fecha o abuso: um competition_id inexistente sempre retorna vazio → nunca entra no edge cache → nunca vira um HIT, então o blob de `matches_cache` no hit só carrega competição real (cardinalidade limitada). O Cache-Control (browser) continua valendo p/ a resposta vazia.
- **Jogo empatado sem vencedor de pênaltis espera o provedor** (`api/src/matches/scoring.ts:300`): Jogo que decide nos pênaltis, terminou empatado (no placar do jogo único ou no agregado da volta) e ainda não tem o vencedor da disputa. Fica sem pontuação até o provedor informar o vencedor: pontuar antes daria zero de classificado e de pênaltis a todos. Usa `decidesOnPenalties`, a mesma regra de `decides_on_penalties` de `GET /matches`.
- **Preview de convite tolera 5 min de cache** (`api/src/public/router.ts:19`): O preview tolera dados com até 5 min de atraso. A Function busca esta rota com `cacheTtlByStatus` (200 por 5 min, 404 por 1 min), e aberturas repetidas do link não chegam ao D1.

#### E-mail e lembretes

- **Índice de jogos por competição e rodada** (`api/migrations/0034_matches_round_index.sql:1`): Índice de jogos por competição + rodada (+ horário). Várias queries buscam "a rodada atual" de uma competição com `GROUP BY round HAVING MAX(start_time) > ?` ou "o início da rodada" com `MIN(start_time) ... WHERE competition_id = ? AND round = ?`. Só com idx_matches_competition, cada uma dessas subqueries varre todos os jogos da competição, e quando ela é correlacionada a cada jogo (contagem de palpites pendentes em …
- **Registro de lembrete diário único por usuário no banco** (`api/migrations/0036_email_reminder_sends.sql:1`): Registro do lembrete diário por e-mail: no máximo um por usuário por dia. O lembrete agora sai em qualquer dia com jogo sem palpite, e a mesma consulta devolve os mesmos usuários a cada execução. Sem registro, um disparo duplicado do cron ou uma nova execução manual repete o aviso. A chave primária faz o limite valer no banco, inclusive entre execuções simultâneas: o cron grava a linha antes de enviar e só envia para…
- **E-mail único case-insensitive** (`api/migrations/0041_users_email_lower_unique.sql:1`): Um e-mail por conta, sem diferença de maiúsculas. `users.email` já é UNIQUE, mas a comparação do SQLite diferencia maiúsculas: `Fulano@Example.com` e `fulano@example.com` podiam virar duas contas. O login passa a gravar o e-mail da conta Google em minúsculas e a atualizá-lo quando muda; este índice faz o banco recusar a segunda conta com o mesmo e-mail em qualquer caixa, e o login trata a recusa como conflito (`email…
- **Admin amarrado ao sub do Google, não ao e-mail** (`api/src/auth/adminPorSub.test.ts:9`): API inteira sobre o D1 em memória. `ADMIN_GOOGLE_SUB` amarra o papel de admin e o acesso a piloto do admin à conta Google dona do `ADMIN_EMAIL`, para que um e-mail reciclado não herde o papel. Todos os valores são sintéticos.
- **From respondível para entregabilidade** (`api/src/notifications/email.ts:8`): Endereço respondível (não "noreply"): um From ao qual dá pra responder melhora engajamento e reduz a chance do Gmail classificar como bulk/Promotions. Requer que lembretes@ exista e roteie no Cloudflare Email Routing, senão respostas quicam.
- **Mensagem do Mailjet sem corpo para não vazar destinatário** (`api/src/notifications/mailjet.ts:35`): Sem o corpo na mensagem: a API pode ecoar o destinatário e vazar no log.
- **Sem rastreio de abertura/clique no e-mail** (`api/src/notifications/mailjet.ts:72`): Sem rastreio de abertura/clique: a página de privacidade lista só o que a Mailjet recebe para entregar o lembrete.
- **Dia do lembrete em fuso de Brasília via Intl** (`api/src/notifications/reminderEmail.ts:3`): O dia do lembrete é o de Brasília. O fuso vem da base do `Intl`; assim, se o horário de verão voltar, o dia não muda.
- **Link de texto simples no e-mail do lembrete** (`api/src/notifications/reminderEmail.ts:118`): Link de texto simples, sem botão colorido nem UTM. E-mail que parece mensagem pessoal tem menos chance de cair na aba Promoções do Gmail.
- **Reenvio de e-mail só para 429/5xx passageiros** (`api/src/notifications/roundReminder.ts:31`): Os envios saem em sequência, um por vez. Um 429 de limite por segundo ou um 5xx passageiro merece nova tentativa, porque o cron só roda uma vez por dia. Outro 4xx é permanente (endereço inválido, por exemplo) e falha na hora.
- **Orçamento de subrequests do lembrete diário (pior caso Free)** (`api/src/notifications/roundReminder.ts:36`): O plano da conta Cloudflare não está confirmado (docs/architecture/ capacidade-coordenacao-provedores.md), então vale o pior caso: Free, com 50 subrequests por invocação. O D1 conta junto com o `fetch`. A invocação gasta 4 consultas fixas (SELECT, batch de reserva, liberação das reservas e a limpeza de segurança do `scheduled`) e deixa 1 de folga, que cobre a nova tentativa da liberação quando a primeira falha. Sobra…
- **Revalidação de descadastro a cada UNSUB_RECHECK_MS** (`api/src/notifications/roundReminder.ts:67`): Por quanto tempo a última leitura de descadastro vale durante o lote. A reserva lê a preferência, e uma tentativa de envio que começa depois desse prazo relê antes de chamar o Resend. Na prática custa uma consulta a cada 5 s de lote: um lote cheio, com envios um por vez, gasta de 1 a 3 vagas do teto nessas releituras. Reler antes de cada envio custaria um subrequest por destinatário e cortaria pela metade quem cabe n…
- **Retry único de leitura/gravação do D1 no cron do lembrete** (`api/src/notifications/roundReminder.ts:75`): Espera antes de repetir uma leitura ou gravação do D1 que falhou. O cron roda uma vez por dia, e uma falha passageira não deve encerrar a fila nem prender reservas.
- **Rodada na chave de agrupamento do lembrete** (`api/src/notifications/roundReminder.ts:433`): Agrupa as linhas por usuário, grupo e rodada. A rodada faz parte da chave porque um grupo pode ter, no mesmo dia, jogo da rodada atual e jogo remarcado de rodada antiga, e cada um precisa do próprio link. As linhas chegam em ordem de horário, então grupos e rodadas ficam na ordem do primeiro jogo.
- **Ordem da fila de envio por último envio** (`api/src/notifications/roundReminder.ts:495`): Ordem da fila de envio quando o teto não cobre todos. Primeiro quem recebeu o lembrete há mais tempo, ou não recebeu nos últimos 7 dias. Quem ficou de fora num dia não tem linha desse dia e passa à frente de quem recebeu. Sem essa regra a fila seguiria só o horário do primeiro jogo, e quem joga à noite ficaria de fora todo dia. No empate vale o jogo que fecha primeiro e, por fim, o id, para a ordem ser estável.
- **Competições em piloto fora do lembrete de quem não tem acesso** (`api/src/notifications/roundReminder.ts:510`): Linhas de competição em piloto ficam só para quem tem acesso ao piloto, o mesmo critério da lista de grupos. Quem saiu de `PILOT_EMAILS` continua membro do grupo, mas não abre o link.
- **Reserva do envio do dia numa gravação só** (`api/src/notifications/roundReminder.ts:542`): Reserva o envio do dia em uma gravação só e devolve os usuários reservados por esta execução. Outra execução no mesmo dia não recebe esses usuários, e a chave primária garante isso mesmo com disparos simultâneos. A gravação é única porque cada consulta ao D1 conta no limite de subrequests do Worker junto com os envios ao Resend. O plano Free tem 50 por invocação. O chamador libera em `finally` as reservas sem aceite …
- **Evento de reserva só com contagem, sem ids** (`api/src/notifications/roundReminder.ts:596`): Só a contagem: os ids identificariam quem ficou sem lembrete.
- **Recusa definitiva do Resend e fallback Mailjet** (`api/src/notifications/roundReminder.ts:645`): Recusa definitiva do Resend: 4xx de validação/conta ou cota esgotada, na primeira tentativa sem falha passageira antes. 409 (idempotência concorrente ou corpo diferente na reexecução) nunca é definitivo: o Resend pode ter aceitado, ou a chave do dia já foi usada. Timeout, 5xx, rede e `UncertainResendError` também ficam de fora.
- **Cron do lembrete pula execução sem chave Resend** (`api/src/notifications/roundReminder.ts:960`): Sem chave, todo envio voltaria 401 e seria contado como lembrete perdido. Melhor pular a execução e expor o erro de configuração.
- **GET de descadastro só confirma; POST muda estado (scanners)** (`api/src/notifications/router.ts:50`): Renders an HTML confirmation page with a POST button. Used by GET /unsubscribe so that e-mail scanners and prefetch proxies (Microsoft Safe Links, etc.) that fire GET requests on every link in a delivered e-mail cannot silently unsubscribe the recipient. Only the POST (submitted by an intentional click) mutates state.
- **Webhook Mailjet responde 200 com payload inválido** (`api/src/notifications/router.ts:152`): Esta rota não usa o validateJson porque um 400 faria a Mailjet reenviar o lote; JSON malformado ou payload fora do formato responde 200 com log.

#### Sync de provedores, ESPN e fila

- **Jogo adiado como coluna postponed em vez de novo status** (`api/migrations/0013_match_postponed.sql:1`): Jogo adiado (POSTPONED/SUSPENDED/CANCELLED no football-data). Por que uma coluna e não um novo valor em `matches.status`: o CHECK original (0001) é `status IN ('scheduled','live','finished')` e o SQLite não permite alterar CHECK sem rebuild da tabela. Rebuild aqui é inviável — `predictions` referencia `matches(id) ON DELETE CASCADE`, então o DROP intermediário apagaria todos os palpites de produção. Flag separada res…
- **Radar de competições: duas fontes e escopo admin** (`api/migrations/0014_competition_radar.sql:1`): Radar de competições — inteligência de produto para decidir QUAIS campeonatos vale a pena incorporar ao Palpitae. Nada aqui alimenta o produto: é insumo do dashboard admin (/admin/oportunidades). Duas perguntas, duas fontes (ver api/src/radar/): 1. "o que está acontecendo agora?" → API-Football (api-sports.io), catálogo de ligas com temporada corrente + jogos do dia. Cobertura ~1.200 ligas, contra as 12 do football-d…
- **Slug de produto divergente via COMP_SLUG_OVERRIDES** (`api/migrations/0025_la_liga_pilot.sql:1`): Seed da La Liga 2026 via football-data PD/2014, visibility pilot. O slug de produto la-liga-2026 diverge do nome cru Primera Division. sync.ts usa COMP_SLUG_OVERRIDES para o upsert achar esta linha.
- **Correção de nomes de clubes por provider/external_id** (`api/migrations/0035_brazilian_club_names.sql:1`): Nome popular dos clubes do Brasileirão Série A vindos da football-data.org. O upsert de times só atualiza logo_url no conflito, então as linhas já gravadas com o nome oficial ("CR Flamengo", "CA Mineiro") precisam desta correção. O filtro por provider e external_id deixa de fora os times da ESPN, que vêm da Série B, da Copa do Brasil, da Libertadores e da Sul-Americana. Sigla (short_name) e slug ficam como estão. Mes…
- **Siglas de clubes da ESPN no lugar da tla da API** (`api/migrations/0038_brazilian_club_abbreviations.sql:1`): Sigla dos clubes do Brasileirão Série A vindos da football-data.org. A tla da API repete "COR" (Coritiba e Corinthians) e traz "PAU", "FBP", "SCI" e "CRE". Passa a valer a abbreviation da ESPN, sem repetição entre os 20 clubes. O upsert de times só atualiza logo_url no conflito, então as linhas já gravadas precisam desta correção. O filtro por provider e external_id deixa de fora os times da ESPN e os europeus da foo…
- **Palpite acompanha times quando provedor inverte mando** (`api/migrations/0039_match_swap_predictions.sql:1`): Mando invertido pelo provedor: o palpite acompanha os times. O palpite guarda o placar por posição (casa e fora). Quando o provedor corrige o mando de um jogo já gravado, o upsert do sync (MATCH_UPSERT_SQL) troca home_team_id e away_team_id. Sem inverter o palpite junto, o "Chelsea 2x1" que a pessoa marcou passaria a valer como vitória do adversário por 2x1. O vencedor dos pênaltis previsto também troca de lado. O ga…
- **Identidade da competição provedor+id externo+temporada** (`api/migrations/0040_competitions_provider_identity.sql:1`): Identidade da competição: provedor + id externo + temporada. O sync da football-data achava a competição pelo slug, derivado do nome que a API envia. Um nome novo para a mesma competição criava uma segunda linha (pública, tipo `cup`, sem fases de pênaltis) e os jogos novos iam para ela. Com este índice o banco recusa a segunda linha, e o sync passa a buscar a competição por esta chave. Checagem de duplicatas antes de…
- **Telemetria do dreno não derruba isolamento de falhas** (`api/src/matches/drainCoordinator.ts:160`): A telemetria que falha não pode derrubar o isolamento de falhas: o gasto do dreno já está contado e os outros seguem para a consolidação.
- **Tolerância de 150 min entre start_time e evento ESPN** (`api/src/matches/espnFallback.ts:76`): Tolerância entre o `start_time` interno e o `date` do evento ESPN. Os dois provedores divergem em remarcamentos de última hora; 150 min cobre isso sem abrir a porta para casar jogos de rodadas diferentes no mesmo dia.
- **Casamento de nomes por contenção nos dois sentidos** (`api/src/matches/espnFallback.ts:134`): Casamento por conter/contido nos DOIS sentidos: football-data usa nomes completos ('Liverpool FC', 'SSC Napoli') e a ESPN os encurta ('Liverpool', 'Napoli'). O sync grava os clubes do Brasileirão com o nome popular (clubNames.ts), que casa com o nome da ESPN. Exige relação em ambos os lados do confronto (mandante-com-mandante e visitante-com-visitante).
- **Fallback ESPN complementar sem fila própria** (`api/src/matches/espnFallback.ts:226`): O fallback é complementar e se replaneja pelo D1 a cada tick: com o acesso recusado ele só espera, sem erro nem fila própria (o resultado principal tem a dele).
- **ESPN agrupa eventos por dia norte-americano: buscar dia UTC e anterior** (`api/src/matches/espnFallback.ts:303`): A ESPN agrupa os eventos por dia norte-americano: um jogo às 00:30Z entra no scoreboard da data UTC do dia ANTERIOR (validado ao vivo — São Paulo×Cruzeiro 2026-10-08T00:30Z aparece em dates=20261007). Por isso buscamos o dia UTC de cada jogo E o anterior; com qualquer fronteira de fuso fixa [X-k, X+k), esses dois dias cobrem todos os eventos cujo kickoff cai na data UTC do jogo.
- **Correção de placar regredida repassa pelo scoring** (`api/src/matches/espnFallback.ts:365`): Uma linha regredida pode já ter scored_at: placar corrigido precisa passar de novo pelo scoring. O guard protege resultados finalizados pelo primário. O jogo disputado deixa de ser adiado: a football-data pode seguir com POSTPONED ou SUSPENDED atrasado, e o upsert não regride a linha encerrada.
- **Limites de concorrência das syncs ESPN** (`api/src/matches/espnQuota.ts:1`): Limites de concorrência das syncs ESPN no discovery e no poller. O cliente HTTP (`providers/espn.ts`) já serializa as requests com intervalo mínimo entre inícios (~1,3s) para evitar 403 Akamai. Este teto limita o trabalho paralelo de upsert/pontuação por competição no Worker quando há até ~10 competições ESPN-primárias ativas ao mesmo tempo.
- **Mapa literal de season.slug da ESPN para fases** (`api/src/matches/espnSync.ts:69`): Tradução de `event.season.slug` da ESPN para o código canônico de fase das copas (mata-mata e grupos). Usado pelos rótulos PT-BR em `rounds.ts` e pelo gate de pênaltis em `competitions.penalty_phases`. Lookup literal: só slugs comprovados nos spikes entram aqui. Caminhos paralelos (Taça Guanabara / Taça Rio, Troféu Inconfidência / playoffs, Farroupilha / título, rebaixamento) ficam com códigos distintos para o admin …
- **Gaúcho first-round como fase de grupos** (`api/src/matches/espnSync.ts:137`): Gaúcho: first-round comprovada como fase de grupos/pontos (spike 2026). Chave = competição + slug; não inferir por presença incompleta de group.
- **Consulta sequencial de datas da ESPN** (`api/src/matches/espnSync.ts:365`): Sequencial: o cliente ESPN já serializa HTTP com pacing; evitar enfileirar N promises de uma vez deixa o custo e o progresso observáveis por data.
- **Calendário só grava se o saldo cobre a gravação inteira** (`api/src/matches/espnSync.ts:407`): O calendário só começa a ser gravado se o saldo do porteiro cobre a gravação inteira: um sync cortado no meio deixaria jogos sem os times deles. Sem saldo, lança antes de gravar qualquer coisa, e o chamador retoma depois.
- **Dreno não reclama itens com provedor bloqueado** (`api/src/matches/espnWork.ts:271`): Com o provedor suspenso ou bloqueado o dreno nem reclama os itens: a própria reclamação recusa (`respectProviderAccess`), então eles ficam pendentes, sem escrita no D1, até o bloqueio vencer ou o operador retomar, e a leitura do estado (1 chamada da fatia) só acontece quando a reclamação veio vazia, para dizer ao operador por que. Num tick com trabalho a ESPN não paga essa leitura. Só registra `provider_work_run` qua…
- **Falha de sync na descoberta vira item pendente da fila** (`api/src/matches/fixtureDiscovery.ts:142`): Qualquer falha vira trabalho pendente: o dreno retoma no mesmo dia, e o progresso da descoberta não espera a de amanhã. Sem vaga ou com cota bloqueada, o prazo segue o reset; nas demais falhas, a espera conservadora. Falta de saldo de subrequests não é falha do provedor.
- **Descoberta ignora competições terminais** (`api/src/matches/fixtureDiscovery.ts:303`): Competições não-terminais com provider sincronizável. 'finished' fica de fora: torneio acabado não ganha jogos novos, não vale gastar chamada da API. A coluna só vira 'finished' dias depois do último jogo (`reconcileCompetitionStatus`), e esses dias são a janela de correção do calendário.
- **Prioridade de competições na descoberta por orçamento** (`api/src/matches/fixtureDiscovery.ts:353`): A consulta prioriza visibilidade pública, uso por grupos e slug, sem preferência por provedor. A reserva pelo custo completo segue essa ordem; o que não cabe vai para a fila antes de qualquer tarefa começar.
- **Orçamento do free tier da football-data.org** (`api/src/matches/footballDataQuota.ts:1`): Orçamento do free tier football-data.org. A API limita a 10 requests/minuto (header `X-Requests-Available-Minute`). Discovery (1×/dia, fora do pico) e poller (~30 min) compartilham esta cota. `FD_MAX_CONCURRENT_REQUESTS` fica abaixo de 10 para deixar folga a retries e sobreposição ocasional entre jobs no mesmo minuto. Um 429 ou a cota zerada pausam as chamadas do isolate até o reset informado (`noteFootballDataRespon…
- **Rodízio da varredura de atrasados** (`api/src/matches/poller.ts:90`): Escolhe no máximo uma tarefa da varredura de atrasados. Só roda no primeiro tick de cada bloco de `LATE_SWEEP_INTERVAL_MS` e alterna entre os candidatos pelo número do bloco, sem estado gravado: um jogo que o provedor nunca resolve não prende a vez dos outros. O índice soma o número do dia ao do bloco, para que um candidato não fique preso ao mesmo horário todo dia: com 8 candidatos e um bloco sempre ocupado, `bloco …
- **Índice 19 primo na varredura de atrasados** (`api/src/matches/poller.ts:114`): O bloco avança um candidato por vez e cada dia desloca a fase em 11. Como são 8 blocos por dia, o índice é (19 × dia + horário) % n; 19 é primo, então abaixo de 19 candidatos nenhum fica preso a um horário. Simulado: até 16 candidatos, com até 3 blocos do dia ocupados, todos são consultados em 7 dias. Acima disso, quem sobrar fica para a descoberta diária, como antes.
- **Reserva de pontuação no fim do tick do poller** (`api/src/matches/poller.ts:188`): Fim do tick reservado à pontuação: a leitura das competições com pontuação pendente e o mínimo para pontuar uma competição (planejar e gravar uma vez). O saldo das sincronizações e o do fallback nunca invadem essa reserva; a pontuação ainda recebe o que sobrar além dela.
- **Football-data reserva saldo de todas as tarefas antes do sync** (`api/src/matches/poller.ts:507`): A football-data reserva o custo de todas as tarefas antes de qualquer sync, na ordem delas, de modo que a tarefa que espera a vez no teto de paralelismo já tem o saldo garantido, e a ESPN, que admite as dela ao começar cada uma, só enxerga o que sobrou.
- **Fallback ESPN consulta D1 após upserts quando HTTP 200 vem atrasado** (`api/src/matches/poller.ts:744`): HTTP 200 pode trazer status atrasado: o fallback consulta o D1 após os upserts e só chama a ESPN quando ainda há partidas elegíveis sem resultado final.
- **Fallback ESPN complementar com reserva de pontuação** (`api/src/matches/poller.ts:747`): O fallback é complementar (o D1 o replaneja a cada tick) e só gasta o que sobra além da reserva da pontuação. Cada competição reserva o custo completo (consulta, datas e gravação) antes de começar, e o D1 e o porteiro dela recusam sem chamar o que passaria do saldo: sem saldo ela espera o tick seguinte, sem fila nem erro. O porteiro cobra os `fetch`, e o observador não os conta de novo.
- **Fencing por dono do lease** (`api/src/matches/providerWork.ts:77`): Dono do lease que o reclamou (fencing): o estado do item só é gravado enquanto o lease ainda é dele. Um dreno lento, cujo lease venceu e foi reclamado por outro, não fecha nem devolve o item do segundo.
- **Fencing: estado do item só grava com o lease dono** (`api/src/matches/providerWork.ts:395`): Fencing: o estado de um item só é gravado se ele segue `running` com o dono que o reclamou. O lease de 5 min vence, e um dreno lento que volta depois de outro ter reclamado o item não o fecha nem o devolve: a instrução não altera linha nenhuma, e o chamador vê `changes = 0` no resultado do batch.
- **Rodada padrão com consulta de fallback própria** (`api/src/matches/router.ts:196`): One D1 round-trip for the full list plus the two queries that pick the default round: the open round from defaultRoundSql (see defaultRound.ts), falling back to the most recent match chronologically. The fallback is its own query rather than result.results.at(-1) because the main list is ordered by group_name first — knockout matches (NULL group) sort last and would otherwise hijack the fallback.
- **Status de jogo não realizado mapeia para scheduled + flag postponed** (`api/src/matches/sync.ts:236`): Status em que o provider diz que o jogo não vai acontecer no horário marcado. Todos continuam mapeando para `status = 'scheduled'` (o CHECK do schema não comporta outro valor, ver migration 0013) — a flag `postponed` é que carrega a informação para o locking e para a UI. CANCELLED fica junto do adiado porque não é terminal: a football-data já mandou como CANCELLED, com data nova, um jogo suspenso que seria retomado (…
- **SUSPENDED mantém palpite travado** (`api/src/matches/sync.ts:250`): Status em que o jogo já começou (ou terminou). SUSPENDED entra aqui: o jogo foi interrompido depois do início e o placar parcial já é conhecido, então o palpite tem que continuar travado mesmo com `postponed = 1`. EXTRA_TIME e PENALTY_SHOOTOUT são a prorrogação e os pênaltis em andamento, como o state 'in' da ESPN.
- **Competição achada pela chave do provedor, nunca pelo nome** (`api/src/matches/sync.ts:355`): Acha a competição pela chave do provedor (id externo + temporada), nunca pelo nome que a API envia: renomear a competição na football-data não pode criar outra. Se ela ainda não existe, cria em piloto com a configuração de `FOOTBALL_DATA_COMPETITIONS`. Código sem configuração não cria nada.
- **Ida/volta da football-data não vem do matchday** (`api/src/matches/sync.ts:595`): A football-data não informa ida e volta: `matchday` não serve para isso (jogo único de mata-mata também vem com matchday 1). O par do confronto é achado pelos times invertidos na mesma fase, em ties.ts.
- **Resultado só com status final e placar completo** (`api/src/matches/sync.ts:604`): Resultado só com status final e placar completo, como na ESPN. A football-data manda placar em jogo em andamento (parcial) e em adiado ou cancelado (0-0), e um FINISHED sem placar gravaria `finished` com placar nulo, que a pontuação não alcança. Nesses casos a linha fica sem resultado; o travamento vem de `locked_at`.
- **Ida pontuada antes da volta existir volta para a fila** (`api/src/matches/sync.ts:650`): Sem `leg`, a pontuação só reconhece a ida pelo par no banco. Uma ida pontuada antes de a volta existir foi tratada como jogo único e recebeu o classificado, que só a volta credita. Quando o par aparece no calendário, a ida que ainda tem classificado volta para a fila de pontuação com `scored_at` nulo, e a pontuação refaz os pontos dela como ida, junto com o ranking. Na ida a pontuação sempre grava classificado zero, …
- **Escudos SVG não renderizam em Gmail/Outlook** (`api/src/notifications/reminderEmail.ts:81`): Escudo do time em <img>. Sem logo, devolve string vazia. Muitos escudos do football-data.org são SVG, que Gmail e Outlook não renderizam e trocam pelo `alt`. O nome do time aparece ao lado, então o layout não quebra.
- **Liberação de reservas em toda saída do lote** (`api/src/notifications/roundReminder.ts:988`): A partir da reserva, toda saída passa pela liberação. Só o aceite do provedor retira um usuário deste conjunto, antes de qualquer log ou outra operação.
- **Telemetria de provedor nunca derruba o sync** (`api/src/observability/providerHttp.ts:85`): Telemetria nunca derruba nem altera o sync.
- **Janela de temporada corrente no radar ESPN** (`api/src/radar/espnRadar.ts:112`): A ESPN deixa a `season` da última edição no scoreboard mesmo depois dela acabar (Copa América 2024, Euro 2024, eliminatórias 2023-25): janela vencida ou nem começada = "não corrente", pular. Sem `season` nenhuma (fora de catálogo) idem. É o equivalente do filtro `current=true` que o catálogo da API-Football fazia.
- **Filtrar jogos do dia por event.date** (`api/src/radar/espnRadar.ts:128`): Jogos daquela data (UTC). OBRIGATÓRIO filtrar pelo `date` de cada evento: para uma data sem jogos a ESPN devolve a rodada vizinha, e para uma liga fora de temporada devolve os últimos jogos — `events.length` sozinho contaria jogos que não são do dia.
- **Script do radar sem BEGIN/COMMIT** (`api/src/radar/sqlCollector.ts:74`): Script pronto para `wrangler d1 execute --file`. **Sem `BEGIN TRANSACTION`/`COMMIT`**, por dois motivos que se somam: o D1 remoto rejeita transação explícita em SQL ("please use the state.storage.transaction() APIs instead of the SQL BEGIN TRANSACTION"), e ela seria redundante — o próprio `d1 execute --file` é atômico: "if the execution fails to complete, your DB will return to its original state". A atomicidade impo…
- **is_current zerado só onde a coleta responde** (`api/src/radar/sync.ts:47`): Zera `is_current` só onde a coleta desta execução responde pelo estado: todas as ligas do provedor, menos as dos slugs que falharam. Liga de slug com falha mantém o estado do último snapshot válido, em vez de sumir do radar porque a ESPN não respondeu hoje. Slug que saiu do recorte não está em `failed` e é rebaixado normalmente.
- **Snapshot vazio não é aplicado (fail-closed)** (`api/src/radar/sync.ts:246`): Nenhuma liga corrente é indistinguível de coleta quebrada (ex.: a ESPN mudou o formato da resposta). Gravar aqui seria aplicar um snapshot vazio por cima do bom — o mesmo fail-closed da falha geral.

#### Pontuação e guardas de gravação

- **Gate data-driven de pênaltis por fase (fail-closed)** (`api/migrations/0010_penalty_picks.sql:1`): Pênaltis no mata-mata: palpite do vencedor dos pênaltis + bônus de pontuação. Gate data-driven por (competição, fase): só pede/pontua pênalti nas fases listadas em competitions.penalty_phases. Comp sem entrada ('[]') = fail-closed (nunca pênalti).
- **Placar canônico (reg+ET) separado dos gols de pênalti** (`api/migrations/0010_penalty_picks.sql:13`): matches: duração da partida + dados dos pênaltis (NULL quando não houve). home_score/away_score passam a guardar o placar canônico (reg+ET); os gols de pênalti ficam à parte p/ display "1-1 (5-4 pênaltis)".
- **Aba Tabela só em pontos corridos via competition type** (`api/migrations/0012_competition_type.sql:1`): Aba "Tabela" (classificação do campeonato) só faz sentido em pontos corridos — na Copa ela servia apenas para a fase de grupos e foi removida da UI. Gate data-driven por competição, mesmo padrão do penalty_phases (0010): default 'cup' = fail-closed (sem tabela); ligas são marcadas explicitamente.
- **Índice parcial de pontuação pendente** (`api/migrations/0034_matches_round_index.sql:20`): Pontuação pendente (scoreUnprocessedMatches): jogos encerrados ainda sem scored_at. Índice parcial, quase sempre vazio, no lugar de varrer a competição inteira a cada tick do poller (~1,7 mil linhas por competição por tick).
- **Repontuação por contexto só em fase eliminatória** (`api/migrations/0044_matches_version.sql:83`): Mudar a composição ou a ordem do confronto pode mudar o jogo decisivo. O próprio jogo volta à fila em qualquer fase. O par antigo e o novo só voltam em fase eliminatória, porque `indexTies` (ties.ts) só monta confronto nelas. Em liga e fase de grupos a repontuação daria o mesmo resultado e reescreveria todos os palpites do jogo e o ranking dos grupos. A lista de fases é a de `KNOCKOUT_PHASES` (rounds.ts), e um teste …
- **Tetos de grupos por usuário (decisão 13/11/2026)** (`api/src/groups/groupCaps.ts:1`): Tetos de grupos por usuário. Decisão do operador em 13/11/2026, registrada em `.scratch/seguranca-2026-11/spec.md` ("Tetos de grupos") e em `docs/security.md`. Eles limitam o custo de `GET /groups`, das escritas em lote e do cron de pontuação. Na data da decisão, o maior uso em produção era de 4 grupos criados e 22 participações.
- **Regras de pontuação só na criação; PATCH altera só points_classified** (`api/src/groups/writeSchemas.ts:54`): Exato, vencedor, pênaltis e visibilidade só se definem na criação; o PATCH muda apenas points_classified. points_penalty é bônus somado e fica fora da regra exato≥vencedor.
- **points_exact >= points_winner (0 liga modo só vencedor)** (`api/src/groups/writeSchemas.ts:65`): points_exact === 0 liga o modo só vencedor (1X2) e sempre passa. Com exato > 0, o placar exato vale pelo menos o mesmo que o vencedor.
- **Casa ambígua pula: nunca pontuar na dúvida** (`api/src/matches/espnFallback.ts:349`): Casa ambígua (ou nenhuma) → pula: nunca pontuar na dúvida.
- **Pontuação por competição com fatia igual do saldo** (`api/src/matches/poller.ts:340`): A pontuação do tick processa uma competição por vez. O erro de uma fica registrado e as outras seguem. Cada competição recebe uma parte igual do que resta, para que uma com muitos palpites não gaste a vez das outras. A parte nunca fica abaixo do mínimo para planejar e gravar uma vez enquanto houver esse mínimo, senão a primeira da lista seria pulada em todo tick. O que sobrar vai, numa segunda passada, para as que pa…
- **Falha de D1 na pontuação relançada após todas as competições** (`api/src/matches/poller.ts:808`): Falha de D1 na pontuação. Depois de todas as competições terem a vez e do tick registrado como erro, a primeira falha é relançada e a invocação sai como exceção.
- **Modo só vencedor (pointsExact 0) não curto-circuita exato** (`api/src/matches/scoring.ts:21`): pointsExact === 0 is the "winner only" / 1X2 mode: there is no exact-score bonus, so we never short-circuit here — otherwise a 1X2 pick stored as (1,0)/(0,0)/(0,1) would accidentally score the exact value when the real score happens to match.
- **Guarda de gravação da pontuação contra mudança posterior** (`api/src/matches/scoring.ts:205`): Condição de toda gravação da pontuação de um jogo: ele segue encerrado com o placar, vencedor nos pênaltis e contexto lidos. Na volta, a ida também precisa continuar existindo e manter seus times, fase, perna e horário. Uma correção ou remoção posterior à leitura impede a gravação dos pontos e do marcador do snapshot anterior: se a ida for apagada entre a leitura e o batch, a volta fica pendente e é pontuada de novo …
- **Tamanho das gravações de pontuação (limite de bind do D1)** (`api/src/matches/scoring.ts:385`): Tamanho de uma gravação. Jogos com poucos palpites dividem a mesma gravação até somar `PREDICTIONS_PER_WRITE` palpites ou `MATCHES_PER_WRITE` jogos. Um jogo com mais palpites que isso vai inteiro numa gravação só dele, com os pontos em instruções de até `PREDICTIONS_PER_STATEMENT` palpites. Cada bind do D1 aceita 2 MB, e os pontos de 1000 palpites ocupam cerca de 50 KB.
- **Ida e volta pontuadas na mesma unidade de gravação** (`api/src/matches/scoring.ts:419`): Agrupa os jogos em unidades de gravação. Ida e volta do mesmo confronto ficam na mesma unidade: gravada sozinha, a ida corrigida sairia dos pendentes e a execução seguinte não repontuaria a volta.
- **Guarda dentro da transação de pontuação aborta batch** (`api/src/matches/scoring.ts:700`): The guard runs inside the write transaction. A sync or prediction edit between the reads above and this batch aborts it, so the caller can rebuild the snapshot.
- **Vencedor dos pênaltis derivado de score.penalties** (`api/src/matches/sync.ts:522`): Vencedor dos pênaltis só faz sentido em PENALTY_SHOOTOUT (score.winner também vem preenchido em jogos REGULAR, onde significa o vencedor no tempo normal). Se o provider mandar winner como null (comum em empates com disputa de pênaltis concluída), derivamos pelo placar da DISPUTA (score.penalties) — fonte canônica e que nunca empata. NÃO derivar de fullTime: quando o provider manda winner null ele também devolve fullT…
- **KPIs de negócio do D1 com datetime() normalizado** (`api/src/observability/metricsRouter.ts:938`): KPIs de negócio a partir do D1 (estado real, não amostrado) — complementa o /overview (Analytics Engine, eventos). "Ativos" aqui é lifetime (toda a base), não a janela de `days`; só contagens "criados no período" respeitam `days`. `datetime(created_at)` normaliza o ISO com `Z` que o login grava em `users` antes de comparar com `datetime('now')`; o texto cru contava o dia do limite inteiro. Ignora grupos soft-deleted …
- **Um db.batch para o PUT em lote com trava relida** (`api/src/predictions/router.ts:1073`): Um único `db.batch`: o schema limita o payload a 100 palpites, o teto do lote do D1. `planned[i]` é o jogo de `statements[i]`. A escrita relê a trava com o relógio do banco, e zero linhas alteradas significa que o jogo travou depois da leitura.

#### Limites, D1 e borda

- **Papel de dono em group_members derivado de owner_user_id** (`api/migrations/0045_group_members_owner_role.sql:1`): Papel de dono em `group_members` mantido a partir de `groups.owner_user_id`. A autorização das ações de dono lê `groups.owner_user_id`, e a lista de membros mostra o selo e o botão de remover a partir de `group_members.role`. Nada ligava os dois: trocar o dono do grupo à mão, ou na exclusão de conta, deixava a interface mostrando o dono antigo. A partir desta migration `role` é derivado do dono do grupo: 'owner' para…
- **Tetos de grupos literais nos testes** (`api/src/groups/groupCaps.test.ts:9`): Tetos por usuário pela API inteira, com o SQL de produção no SQLite em memória. Os números ficam literais aqui porque refletem a decisão do operador, e o teste precisa quebrar se a constante mudar sem querer.
- **json_each em um bind para o limite de 100 parâmetros do D1** (`api/src/groups/router.ts:225`): Usa json_each em um único bind para não estourar o limite de 100 parâmetros do D1.
- **Tetos por usuário conferidos no próprio INSERT** (`api/src/groups/router.ts:519`): Os tetos por usuário são conferidos no próprio INSERT do grupo. Um SELECT COUNT separado deixaria duas criações simultâneas passarem do teto. O dono vira participante, então a criação também respeita o teto de participações. Com o grupo recusado, o INSERT do dono não encontra o grupo e não grava nada.
- **Bloqueio local em memória quando o D1 não grava a proibição** (`api/src/matches/espnAccess.ts:246`): Bloqueio local do isolate (em memória) para uma proibição que o D1 não gravou. Sem ele, a próxima reserva leria o D1 ainda livre e passaria: o request que a resposta proibiu se repetiria. Vale para toda reserva do isolate, inclusive as chamadas já enfileiradas no mutex do cliente, e só cai depois que a proibição é gravada (o D1 passa a ser a verdade) ou, num bloqueio por prazo (429, 403), depois que o prazo vence. Um…
- **Instante único para pausa do isolate e bloqueio no D1** (`api/src/matches/sync.ts:310`): Um único instante para a pausa do isolate e o bloqueio no D1: dois relógios divergiriam em ms e o retry veria o D1 ainda bloqueado.
- **Limite de bytes por linha NDJSON** (`api/src/observability/archiveQuery.ts:22`): Linha com mais bytes UTF-8 que isso (sem contar a quebra) conta como malformada e é descartada sem acumular o resto. Uma linha real tem ~615 bytes; sem o limite, um arquivo sem quebra de linha juntaria o corpo inteiro na memória.
- **Export diário do AE para R2 (cold path)** (`api/src/observability/export.ts:4`): Cold path — arquiva um dia de eventos do Analytics Engine no R2 como NDJSON, com retenção de 13 meses pela regra de ciclo de vida do bucket (o AE só guarda ~3 meses). Roda num cron diário (00:05 UTC) e exporta o dia ANTERIOR. Ver `docs/observability.md`. Desenho: o AE é o staging (escrita barata, sem latência); este export "congela" tudo em R2 1x/dia. Um arquivo/dia ⇒ ~365 escritas/ano, irrisório no free tier (10 GB,…
- **Linhas por consulta à SQL API do AE** (`api/src/observability/export.ts:22`): Linhas por consulta. A SQL API do Analytics Engine corta o resultado (~10k linhas) silenciosamente; com o teto explícito, página cheia significa "pode haver mais" e a coleta continua a partir do último segundo lido.
- **Teto de páginas por dia no export** (`api/src/observability/export.ts:27`): Teto de páginas por dia (30 mil linhas, cerca de 120 vezes o maior dia de 2026): o dia inteiro fica em memória antes do put, e o Worker tem 128 MB. Dia que passa disso tem os tipos de volume cortados, como descreve `collectRows`. Se o corte alcança eventos de negócio, o dia é gravado incompleto e reconsultado a cada execução.
- **Tipos de volume cedem espaço a eventos de negócio** (`api/src/observability/export.ts:37`): Tipos de evento de alto volume e baixo valor. Quando o dia passa do teto, eles cedem espaço aos eventos de negócio. Os demais, como `account_created` e `security_storage_error`, são lidos por uma consulta própria. O tipo vem de `blob1`, que o AE guarda repetido do índice, como descreve `events.ts`.
- **SQL API do AE sem bind params: validação de instantes** (`api/src/observability/export.ts:127`): A SQL API do Analytics Engine é ClickHouse-like e não aceita bind params: todo instante interpolado na consulta passa por esta validação.
- **Leitura do dia em ordem de tempo com segunda leitura de negócio** (`api/src/observability/export.ts:214`): Lê o dia em ordem de tempo, em 1 a 3 páginas. Se a leitura chega ao fim do dia, o arquivo sai como sempre. Se ela para antes (3 páginas esgotadas, ou um único segundo com ROW_LIMIT linhas ou mais), o que ficou depois do corte pode esconder eventos de negócio e de segurança atrás de tráfego de volume. Então uma segunda leitura, de até MAX_BUSINESS_PAGES páginas, traz só os eventos fora da lista de volume dali em diant…
- **Fila durável lida do D1, falha marca pendingWorkError** (`api/src/observability/metricsRouter.ts:420`): Fila durável: estado real do D1 (não AE). Só itens abertos ou falhos. Envolve em Promise.resolve para um stub sem `.all` não lançar ao montar o Promise.all (senão as consultas AE já disparadas ficam órfãs). Falha do D1 marca `pendingWorkError` em vez de lista vazia (vazio ≠ indisponível).
- **Endpoints de métricas separados por painel** (`api/src/observability/metricsRouter.ts:565`): Criações de grupo e atividade de palpites por campeonato no período, a partir do Analytics Engine. Endpoint próprio (como `/ops`) para que uma falha aqui não derrube a página e para o front novo conviver com uma API ainda sem a rota. Posições: group_created → blob3 competition_id; prediction_saved → blob6 competition_id (só em eventos gravados depois do deploy do enriquecimento), double1 = nº de palpites do evento. E…
- **Validar código de convite antes de consultar o D1** (`api/src/public/router.ts:14`): Formato e alfabeto de `generateInviteCode` (groups/router.ts): XXXX-XXXX sem I, O, 0 e 1. Validar antes de consultar evita bater no D1 com lixo e limita o que um scanner pode testar por requisição.
- **Balde anônimo compartilhado separado para o front** (`api/src/security/limits.ts:25`): Teto do balde anônimo compartilhado: tráfego que chega por um Worker sem o segredo válido, quando não há como saber o IP do visitante. Há um balde para o próprio front e outro para os demais Workers, para que um Worker de terceiros não esgote a quota de quem usa o site. O front é o CF-Worker igual ao host do FRONTEND_URL, a um domínio pai dele ou ao FRONTEND_WORKER_ZONE.
- **WHERE do DO UPDATE evita escrita em requisição recusada** (`api/src/security/limits.ts:65`): D1 serializes the upsert, including requests from different Worker instances. `key` should already be an opaque hash (see bucketKey). O WHERE do DO UPDATE impede a escrita quando o balde da janela atual já está cheio: a requisição recusada só lê a linha, não grava nada, e o RETURNING volta vazio. Assim um cliente insistente recebendo 429 não vira uma escrita no D1 por requisição.
- **HMAC com segredo na chave de limite por IP** (`api/src/security/limits.ts:337`): HMAC com segredo: um SHA-256 puro de um IPv4 sai por força bruta.
- **Limite de 5 cron triggers do plano Free** (`api/src/wrangler-config.test.ts:203`): O plano Free permite 5 triggers por CONTA e a conta já usa 1 em outro Worker: sobram 4 para esta API. Com 5 o Deploy API falha com "This account has reached the Workers Free limit of 5 cron triggers per account [code: 10072]" (PR #769, run 44009052934). Para agendar algo novo, use um minuto novo do trigger fundido em vez de um cron novo.
- **API só em api.palpitae.com.br com workers_dev desligado** (`api/wrangler.toml:10`): A API responde só por api.palpitae.com.br, domínio ligado ao Worker no painel. O arquivo não declara `routes` nem `custom_domain`, então o deploy não mexe nesse vínculo. Pelo mesmo motivo o wrangler trata `workers_dev` ausente como ligado, e estas duas chaves precisam ficar aqui para o deploy não religar o workers.dev nem as previews por versão. Ver docs/security.md.

#### Métricas e export AE→R2

- **Leitura do arquivo frio em streaming com memória limitada** (`api/src/observability/archiveQuery.ts:1`): Leitura do arquivo frio para `GET /metrics/archive/query` com memória limitada. Ver `docs/observability.md`. Um dia cheio tem até 30 mil linhas de ~615 bytes (~18 MiB). Ler os corpos de um mês inteiro de uma vez passa dos 128 MiB do Worker, então cada arquivo é lido sozinho, em streaming, linha a linha, e o corpo é solto antes do próximo. A memória fica em um pedaço do stream, um trecho de linha de até 64 KiB e os co…
- **Dia só completo 24 h depois de terminar** (`api/src/observability/export.ts:55`): Um dia só é dado como completo quando exportado ao menos 24 h depois de terminar. O export das 00:05 é provisório e vira definitivo no cron seguinte, que reconsulta o dia e pega linhas que a SQL API ainda não devolvia.
- **Fim da retenção do AE fecha o dia com o corpo arquivado** (`api/src/observability/export.ts:63`): A partir de quantos dias atrás uma coleta completa com MENOS linhas que o arquivo fecha o dia com o corpo arquivado. Perto do fim da retenção do AE (~90 dias) a coleta só tende a encolher; antes disso, a diferença pode ser passageira e o dia continua aberto para a próxima execução.
- **customMetadata já vem no list() do R2** (`api/src/observability/metricsRouter.ts:1161`): customMetadata vem por padrão no list() (compatibility_date ≥ 2022-08-04 — a opção `include` nem existe mais no runtime atual).

#### Grupos, schema e índices

- **Índice group_members por user_id** (`api/migrations/0037_group_members_user_index.sql:1`): Índice de membros por usuário. GET /groups parte de "os grupos deste usuário" (`gm.user_id = ?`), mas nenhum índice de group_members começa por user_id. O plano era `SCAN gm USING COVERING INDEX sqlite_autoindex_group_members_2`, que lê a tabela inteira a cada abertura da home. Com este índice vira uma busca por user_id, sem mudar o resultado. Custa uma escrita de índice a mais por entrada e saída de membro.
- **Ordem dos gatilhos BEFORE de times iguais e swap** (`api/migrations/0044_matches_version.sql:69`): O gatilho BEFORE roda antes do `matches_swap_predictions` (0039, AFTER), então um confronto com times iguais aborta antes de inverter palpites.
- **Trigger de compatibilidade para Worker antigo sem public_id** (`api/migrations/0051_group_join_requests.sql:17`): Worker antigo ainda pode inserir grupos sem public_id até o publish do código novo.
- **Marca de primeira leitura para backfill de marcos** (`api/migrations/0052_exact_milestones.sql:24`): Grupo já passou pela primeira leitura com rodada de referência após o deploy. Sem esta marca, um grupo novo lido com 0 exatos e depois com 5 seria tratado como backfill e perderia o destaque do primeiro cruzamento.
- **Status da competição derivado dos jogos reais** (`api/src/competitions/router.ts:22`): `competitions.status` só vira 'finished' na descoberta diária, 7 dias depois do último jogo, então o `status` devolvido aqui é derivado dos jogos reais. O fim vem da regra compartilhada com os grupos (`competitionStatusSql`): copa só acaba com jogo de fase de título encerrado e nenhum pendente. Fora disso, com jogo encerrado a competição está em andamento. Sem jogos, vale a coluna.
- **Caracteres invisíveis legítimos em nomes de grupo** (`api/src/groups/groupName.ts:4`): Usos legítimos de caractere invisível num nome. Saem do texto antes da busca por caracteres proibidos: - seletor de variação texto/emoji (U+FE0E, U+FE0F) logo depois de um caractere visível, como em ❤ + U+FE0F; - junção U+200D entre dois emoji, como em homem + U+200D + mulher + U+200D + menina; - bandeira de subdivisão: U+1F3F4, código ISO 3166-2 em tags minúsculas e U+E007F, como na bandeira da Inglaterra (gbeng).
- **CTE competition_info no GET /groups para custo de leitura** (`api/src/groups/groupsList.queryPlan.test.ts:6`): O GET /groups roda a cada abertura da home. A CTE `competition_info` separa as competições distintas do usuário e calcula status e rodadas abertas uma vez por competição, em vez de repetir a varredura de jogos por grupo. Cada grupo lê apenas os jogos das rodadas abertas já resolvidas, além do prazo, do próximo jogo e do fim da rodada no mesmo resumo. Este teste falha se a CTE deixar de ser materializada, se um campo …
- **Resposta genérica de pedido de entrada não vaza ban/piloto** (`api/src/groups/joinRequestRoutes.ts:205`): Grupo inexistente, piloto sem acesso ou link desligado: mesma resposta. Banimento também cai na mensagem genérica (não vaza o status de ban).
- **Pódio de grupos encerrados com ROW_NUMBER numa query** (`api/src/groups/router.ts:410`): Pódio só para grupos encerrados: o card ativo mostra "como vou", o encerrado mostra "quem ganhou". Buscamos os 3 primeiros de cada grupo finalizado numa única query com ROW_NUMBER(), em vez de N subqueries no SELECT principal.
- **Rotas /join-requests antes de /:id** (`api/src/groups/router.ts:654`): Pedidos pelo link público: /join-requests antes de /:id para o segmento estático não ser lido como id de grupo.
- **Linha do leaderboard permanece quando membro sai** (`api/src/groups/router.ts:1016`): A linha do `leaderboard` fica: as leituras do ranking partem de `group_members`, e quem volta ao grupo recupera os pontos que tinha.
- **Transição do trigger fundido do poller** (`api/src/index.ts:162`): Transição do deploy (ver crons.ts): o agendamento antigo do poller ainda pode chegar até a Cloudflare propagar o trigger fundido. Só o poller.
- **Marca de importação vive em group_members** (`api/src/predictions/importCompleted.test.ts:75`): Comportamento aceito (ticket de exclusão de conta e jogo, 11/2026): a marca vive na linha de `group_members`, que sai junto com o membro. Quem volta ao grupo encontra os palpites importados e o seletor aberto de novo. Ver `docs/architecture/schema.md`.
- **Palpites e marcador de importação no mesmo lote** (`api/src/predictions/importPredictions.ts:192`): Palpites e marcador no mesmo lote: se um falha, nada fica gravado. O marcador entra se algum palpite já era igual ou se o lote gravou algum, o que deixa no destino uma linha com o `updated_at` deste lote.

#### Radar e coleta

- **Radar genérico por esporte** (`api/migrations/0014_competition_radar.sql:17`): Genérico desde já: hoje só 'football', mas o desenho não muda quando entrarem NBA/NFL/F1 (outro provider, mesma tabela).
- **Coleta vazia falha o workflow** (`api/scripts/radarSync.ts:35`): Sem statements = a coleta falhou (a própria syncRadar já logou o motivo). Falhar aqui é o que faz o workflow ficar vermelho em vez de aplicar um arquivo vazio e fingir sucesso.
- **Coleta parcial ainda é aplicada com aviso** (`api/scripts/radarSync.ts:46`): Coleta parcial ainda é aplicada (as ligas sem resposta mantêm o snapshot anterior), mas o aviso aparece no resumo da execução do Actions.
- **Política de substituição do arquivo diário** (`api/src/observability/export.ts:353`): A coleta nova substitui o arquivo? Eventos de negócio decidem primeiro: com menos deles, nunca; com mais, sempre, mesmo que o total de linhas caia (o arquivo antigo pode ter sido cheio de volume antes de chegar a eles). Com os mesmos, vale o total: mais linhas, ou coleta completa com ao menos as mesmas.
- **Snapshot por temporada normaliza ISO com Z** (`api/src/observability/metricsRouter.ts:999`): Snapshot por temporada. datetime(p.updated_at) normaliza o ISO com "Z" gravado pelo app para o formato do datetime('now') antes de comparar; datetime(m.start_time) faz o mesmo (aceita "Z", milissegundos e offset).
- **Interesse do radar medido por pageviews da pt.wikipedia** (`api/src/radar/articles.ts:1`): Curadoria do radar: quais competições entram e como medir o interesse do público brasileiro por cada uma. O sinal de interesse vem de pageviews diários da **pt.wikipedia**. Não existe API pública utilizável do Google Trends (o pytrends foi arquivado em 2025 e a API oficial é alpha fechada), e pt.wikipedia ≈ audiência brasileira, o que torna os números comparáveis entre competições. ⚠️ Os títulos abaixo são os **canôn…
- **Janela de pageviews recoletada a cada execução** (`api/src/radar/sync.ts:14`): Dias de pageviews recoletados a cada execução. Não basta pegar "ontem": a Wikimedia consolida com 1-2 dias de atraso, então a janela reprocessa os dias que ainda estavam vazios. O upsert por (radar_id, day) torna isso idempotente.

#### Outras

- **locked_at trava palpite mesmo com jogo adiado depois** (`api/migrations/0016_match_locked_at.sql:1`): Instante em que o sync viu o jogo iniciado pela primeira vez. O palpite trava pelo horário enquanto o jogo não está adiado. Quando o provider marca o jogo como SUSPENDED/POSTPONED/CANCELLED depois do início, o sync grava `postponed = 1` e o status volta para 'scheduled', o que destravava palpites já revelados aos outros membros. `locked_at` é gravado quando o provider indica que o jogo começou (IN_PLAY, PAUSED, LIVE,…
- **payments sem cascata sai junto na exclusão de conta** (`api/src/admin/router.ts:67`): `payments` não tem cascata para `users` e segue sem uso; sai junto para não travar a exclusão.
- **Whitelist de colunas em findVisibleGroup** (`api/src/groups/router.ts:163`): Colunas de `groups` que as ações de dono leem. `findVisibleGroup` só aceita estas chaves, então a lista que vai para o SELECT nunca vem de entrada do usuário.
- **Content-Type recriado para o validator JSON do Hono** (`api/src/http/validateJson.ts:77`): O validator JSON do Hono ignora o corpo e valida `{}` quando o Content-Type falta ou não é JSON. Por isso o Request é recriado com `application/json` e o corpo já lido.
- **Desempate das rodadas candidatas (rodada padrão)** (`api/src/matches/defaultRound.ts:39`): Ordem das candidatas. A primeira é a rodada padrão. Empate no último jogo aparece no fim de temporada, quando duas rodadas antigas têm um remarcado no mesmo horário. Vence a que começou depois. A dica da aba Palpitar procura rodadas antes da aberta, então aponta a outra. `round` fecha o desempate, porque é a chave do `GROUP BY`.
- **Esperar todas as datas antes de propagar falha (reserva do saldo)** (`api/src/matches/espnFallback.ts:321`): Espera todas as datas antes de propagar a falha de uma delas: a reserva da competição só é devolvida depois que nenhuma chamada dela está em andamento, senão o saldo do tick conta menos do que foi gasto. A falha propagada é a da primeira data da lista, a mesma que `Promise.all` escolheria na ordem.
- **Só ano explícito autoriza importar evento de outra edição** (`api/src/matches/espnSync.ts:300`): O scoreboard pode responder com outra edição ao consultar datas futuras. Só o ano explícito do evento autoriza importá-lo para a temporada pedida.
- **Cardinalidade limitada do blob matches_cache** (`api/src/matches/router.ts:357`): Cap dimension cardinality: only real competitions (response had games) get their id; random junk competition_id from anon flooding all collapse into one 'unknown' bucket.
- **Reserva de vaga e fetch juntos no saldo** (`api/src/matches/sync.ts:296`): A reserva da vaga e o `fetch` cabem juntos no saldo ou nenhum dos dois sai: sem o `fetch`, a vaga reservada ficaria gasta à toa para as outras execuções.
- **Leitura e baixa do saldo síncronas entre competições** (`api/src/matches/sync.ts:445`): Leitura e baixa do saldo no mesmo trecho síncrono: competições em paralelo não gastam o mesmo saldo duas vezes.
- **Meia-noite seguinte em Brasília com horário de verão** (`api/src/notifications/roundReminder.ts:404`): Primeiro instante do dia seguinte em Brasília. A meia-noite usa o deslocamento de agora e, se ele mudar até lá, o de depois da mudança. Fica o menor candidato que já cai no dia seguinte. No início do horário de verão a meia-noite não existe e o dia acaba quando 00:00 vira 01:00. No fim, a hora repetida ainda conta como dia anterior.
- **Páginas de eventos de negócio após o corte** (`api/src/observability/export.ts:51`): Páginas da consulta de eventos de negócio depois do corte. Esses eventos somam centenas por dia; duas páginas bastam e limitam o custo em chamadas ao AE.
- **Jogo relido na própria escrita da cópia de palpites** (`api/src/predictions/replicate.ts:247`): O jogo é relido na própria escrita, com o relógio do banco. Se ele travou ou começou depois das consultas, nada é gravado.
- **Anti-cópia no join de palpites do usuário** (`api/src/predictions/router.ts:446`): Fetch all matches for the group's competition, left-joining predictions. The join condition restricts predictions to LOCKED matches (anti-copy: picks that can still be edited are not revealed even if the target user already submitted them). Jogo adiado não conta como começado — ver locking.ts.
- **Trava rechecada na escrita com relógio do banco** (`api/src/predictions/router.ts:824`): A conferência acima é a resposta rápida. A escrita relê a trava com o relógio do banco, e zero linhas alteradas significa que o jogo travou depois da leitura.
- **CF-Connecting-IP trocado em subrequest entre zonas** (`api/src/security/limits.ts:42`): Em subrequests de Worker entre zonas diferentes, a Cloudflare troca o CF-Connecting-IP por este endereço fixo e adiciona o header CF-Worker. https://developers.cloudflare.com/fundamentals/reference/http-headers/
- **wrangler exige --config ./wrangler.toml** (`api/wrangler.toml:1`): Todo comando wrangler rodado em api/ precisa de --config ./wrangler.toml. Sem ele o wrangler procura wrangler.json e wrangler.jsonc em todos os diretórios acima antes de aceitar este arquivo. Até 14/11/2026 o wrangler.jsonc da raiz vencia; ele saiu, e a opção fica para que um arquivo recriado acima não volte a desviar os comandos. Os scripts dev, dev:cron e deploy do package.json já passam a opção.

### Consequences

- O código deixa de carregar o racional; a fonte da verdade passa a ser esta ADR e as ADRs apontadas.
- Detalhe operacional fino (números de bench, mensagens de teste) que não é decisão de arquitetura ficou de fora e permanece no baseline do ratchet para limpeza posterior.
- Tickets de excuse desta passagem: `.scratch/no-comments-2026-11/issues/` no worktree principal.

---

## ADR-031: Colheita de decisões dos comentários do web (2026-11)

**Status:** Accepted
**Date:** 2026-11-21

### Context

Passagem de limpeza de comentários em `web/`. Decisões não óbvias saem do fonte para este registro; tautologias e excuses foram apagadas (excuses viram tickets em `.scratch/no-comments-2026-11/issues/`).

### Decision

#### Auth, sessão e bootstrap do App

- **GA4 + Consent Mode v2 for the static /guias/* pages** (`web/build/analytics.ts:1`): GA4 + Consent Mode v2 for the static /guias/* pages. * * The guides are plain HTML without the React bundle, so they can't call * `initGa()` (src/analytics/ga.ts) or mount `CookieConsent`. This module emits a * small inline equivalent that must stay in sync with those two files: * * - same localStorage key and value format (`granted` / `denied:<timestamp>`, …
- **Variáveis de ambiente que o build de produção exige** (`web/build/env.ts:1`): Variáveis de ambiente que o build de produção exige. * * O Vite troca `import.meta.env.VITE_*` pelo valor no momento do build. Uma * variável ausente cai no padrão de desenvolvimento (`http://localhost:8787`) e * uma malformada só aparece no navegador: `VITE_AUTH_URL=/api` faz o botão * "Entrar com Google" lançar TypeError no clique. O `vite.config.ts` chama…
- **Last commit date (YYYY-MM-DD) touching any of `paths`, for a truthful sitemap * <lastmod>** (`web/build/guides.ts:1217`): Last commit date (YYYY-MM-DD) touching any of `paths`, for a truthful sitemap * <lastmod>. Uses git so it reflects real content changes instead of the build * date. Falls back to `fallback` when git history is unavailable (e.g. a shallow * CI checkout or an untracked path), so the build never breaks.
- **O aviso de cookies só existe com um id do GA, e ele não pode cobrir os demais testes** (`web/playwright.config.ts:3`): O aviso de cookies só existe com um id do GA, e ele não pode cobrir os demais testes.
- **Visita anônima: o endpoint responde 200 (não 401) para não aparecer como // erro no console do navegador** (`web/src/App.test.tsx:635`): Visita anônima: o endpoint responde 200 (não 401) para não aparecer como // erro no console do navegador — ver PAGESPEED_REPORT.md item 3.
- **The authenticated pages pull in the heavy app surface (modals, tabs)** (`web/src/App.tsx:32`): The authenticated pages pull in the heavy app surface (modals, tabs). * They are code-split so a first-time visitor on the public landing * only downloads the marketing chunk, not the whole app. While a chunk loads * the Suspense fallback is null — the dark background (painted inline in * index.html) carries the screen, so there's no spinner flash. * * Login…
- **Raiz para quem não tem sessão** (`web/src/App.tsx:71`): Raiz para quem não tem sessão. Link antigo com `?convite=` e sessão que * expirou num dispositivo conhecido caem aqui, e a pessoa vê o convite. O * redirecionamento espera o auth resolver, para a hidratação da landing casar * com o HTML pré-renderizado.
- **`unavailable`: o `/auth/me` respondeu 5xx** (`web/src/App.tsx:86`): `unavailable`: o `/auth/me` respondeu 5xx. Não sabemos se há sessão, então ninguém é // deslogado e a marca de sessão conhecida fica como está.
- **Marca, em localStorage, que este dispositivo já teve uma sessão autenticada** (`web/src/App.tsx:90`): Marca, em localStorage, que este dispositivo já teve uma sessão autenticada. * * O cookie de sessão é HttpOnly (invisível ao JS), então essa é a única pista * que temos, antes de o `GET /auth/me` responder, sobre quem está chegando. * A marca controla a pintura antecipada da landing e o aviso de indisponibilidade * nas rotas públicas. Para o LCP: um visitant…
- **Raw fetch on purpose** (`web/src/App.tsx:174`, `web/src/App.tsx:253`): Raw fetch on purpose: an anonymous visit is the normal logged-out state, // not an expired session — apiFetch would flag "sessão expirou" for every // visitor. The endpoint answers 200 either way (`{ user }` or // `{ authenticated: false }`) so a logged-out visit never surfaces as a // console error in devtools/Lighthouse.
- **Any apiFetch call that hits a 401 broadcasts this event** (`web/src/App.tsx:235`): Any apiFetch call that hits a 401 broadcasts this event. Drop auth state so the // router swaps to the login screen instead of leaving tabs stuck on their own // "erro ao carregar" with no data. LoginPage reads the flag to explain why.
- **Logout explícito apaga os rascunhos de palpite deste navegador** (`web/src/App.tsx:244`): Logout explícito apaga os rascunhos de palpite deste navegador. A sessão // expirada mantém, porque a pessoa volta a entrar e recupera o que digitou. // // A tela sai do estado logado mesmo quando o servidor não confirma a revogação. // Num 503 a API já apagou o cookie; numa falha de rede ele pode ter ficado. Nos // dois casos o token pode continuar valendo,…
- **"Sair de todos os dispositivos" já apagou o cookie e as sessões no servidor** (`web/src/App.tsx:276`): "Sair de todos os dispositivos" já apagou o cookie e as sessões no servidor.
- **Enquanto o auth resolve, a landing continua na tela para quem chegou com // ela pré-renderizada** (`web/src/App.tsx:282`): Enquanto o auth resolve, a landing continua na tela para quem chegou com // ela pré-renderizada: ela não depende de nenhum dado da sessão, e esperar o // `GET /auth/me` para pintá-la era parte do que atrasava o LCP no mobile. As // demais rotas continuam esperando, porque dependem de saber quem é o usuário.
- **O convite e o link de pedido também não esperam o auth** (`web/src/App.tsx:290`): O convite e o link de pedido também não esperam o auth: o visitante decide // nessa tela se entra. Quem tem sessão conhecida já saiu de `/convite/` no // script do index.html.
- **Com o `/auth/me` em 5xx, a landing e o convite seguem no ar para quem nunca // teve sessão neste dispositivo** (`web/src/App.tsx:299`): Com o `/auth/me` em 5xx, a landing e o convite seguem no ar para quem nunca // teve sessão neste dispositivo. As rotas privadas e quem tem a marca de sessão // veem o aviso. A URL fica como está: com a API de volta, "Tentar novamente" // abre a mesma rota.
- **O OAuth sai do app (Google → API → volta para o front) e o retorno não traz // nenhum sinal de "acab** (`web/src/analytics/funnel.ts:49`): O OAuth sai do app (Google → API → volta para o front) e o retorno não traz // nenhum sinal de "acabou de logar". O clique no botão marca a aba; quando o // /auth/me responde, o App consome a marca e, se a sessão existir, conta o login. // sessionStorage porque a marca só faz sentido nesta aba e nesta ida ao Google.
- **`accounts.google.com` fica de fora de propósito** (`web/src/analytics/signupOrigin.ts:15`): `accounts.google.com` fica de fora de propósito: é a volta do OAuth, não uma busca.
- **Sublinhado no link da política de privacidade** (`web/src/components/CookieConsent/CookieConsent.module.css:27`): Sublinhado no link da política de privacidade: o verde da marca contra o cinza do texto não basta para distingui-lo (Lighthouse `link-in-text-block`).
- **Enquanto o auth ou o chunk da rota carregam, o App não pinta nada e o botão vira o primeiro filho do** (`web/src/components/CookieConsent/CookieConsent.module.css:90`): Enquanto o auth ou o chunk da rota carregam, o App não pinta nada e o botão vira o primeiro filho do #root, solto no topo da tela escura. Escondido nesse intervalo, ele só aparece já abaixo da página, sem salto de layout.
- **apiFetch em vez de fetch cru** (`web/src/components/CreateGroupModal/hooks/useCreateGroupForm.ts:75`): apiFetch em vez de fetch cru: em dev o modal roda cross-origin (5173 → // 8787) e sem credentials o cookie de sessão não vai — 401 garantido.
- **A mesma regra dos rascunhos e do "Salvar todos"** (`web/src/components/MatchCard/useMatchCard.ts:35`): A mesma regra dos rascunhos e do "Salvar todos". Fecha com `locked_at`, status // `live` ou `finished`, ou horário vencido sem adiado, como // `api/src/matches/locking.ts`. Fora do adiado, o `locked` do palpite também fecha.
- **Só reage quando o palpite salvo muda** (`web/src/components/MatchCard/useMatchCard.ts:80`): Só reage quando o palpite salvo muda. Na montagem, o valor inicial pode ser // um rascunho restaurado, e o efeito não deve sobrescrevê-lo.
- **Início mais recente até `now`, ou 0** (`web/src/components/PredictionsTab/usePredictionDrafts.ts:15`): Início mais recente até `now`, ou 0. O travamento por horário só muda nesses * instantes, e com este valor a poda dos rascunhos recalcula só quando um jogo * começa. Gravar o storage a cada tique do relógio sobrescreveria o rascunho de * outra aba aberta no mesmo grupo.
- **Sem esta limpeza, o rascunho velho voltaria se o salvo retornasse ao valor // da base, por exemplo n** (`web/src/components/PredictionsTab/usePredictionDrafts.ts:53`): Sem esta limpeza, o rascunho velho voltaria se o salvo retornasse ao valor // da base, por exemplo numa segunda importação.
- **O importado muda o palpite salvo, e `usePredictionDrafts` descarta o // rascunho digitado sobre o va** (`web/src/components/PredictionsTab/usePredictionsTab.ts:375`): O importado muda o palpite salvo, e `usePredictionDrafts` descarta o // rascunho digitado sobre o valor anterior. O palpite salvo enquanto a // listagem chegava fica.
- **Um relógio só para o cabeçalho, os cards e os rascunhos** (`web/src/components/PredictionsTab/usePredictionsTab.ts:444`): Um relógio só para o cabeçalho, os cards e os rascunhos. Ele também vira no // início de cada jogo, e o card trava no mesmo instante que a API.
- **Rodadas com rascunho de palpite não salvo** (`web/src/components/RoundHeader/RoundHeader.tsx:26`): Rodadas com rascunho de palpite não salvo. O aviso de saída conta todas as * rodadas, e o marcador mostra onde está cada rascunho.
- **{/* `landingPrerenderizada` faz o App pintar a landing sem esperar o /auth/me** (`web/src/entry-server.tsx:33`): `landingPrerenderizada` faz o App pintar a landing sem esperar o /auth/me — é exatamente o estado em que o cliente hidrata. */}
- **Thin wrapper around `fetch` for calls to the Palpitae API** (`web/src/lib/api.ts:1`): Thin wrapper around `fetch` for calls to the Palpitae API. * * Two things every authenticated call needs, in one place: * - `credentials: 'include'` so the session cookie rides along; * - a single point that notices a 401 (expired/absent session) and tells * the app to bounce the user back to login instead of leaving each tab * stuck on its own "erro ao carr…
- **O build embute a landing dentro do `#root` (ver `scripts/prerender.mjs`) e * marca o elemento com `d** (`web/src/main.tsx:20`): O build embute a landing dentro do `#root` (ver `scripts/prerender.mjs`) e * marca o elemento com `data-prerender="landing"`. O script inline no fim do * `index.html` remove esse conteúdo — e o atributo — quando a landing não é o * que o visitante deve ver (rota privada ou dispositivo com sessão conhecida). * * Então o atributo, aqui, significa exatamente "a…
- **Alerta proporcional de falhas de login no painel admin** (`web/src/pages/AdminMetricsPage/loginFailureAlert.ts:1`): Alerta proporcional de falhas de login no painel admin. * * Limiares calibrados em 2026-11-02 com agregados do Analytics Engine * (SUM(_sample_interval), sessão admin em /admin/metricas), sem PII: * * | Janela | sucessos | falhas | callbacks | proporção | * | 7d | 6 | 1 | 7 | 14% | * | 30d | 21 | 5 | 26 | 19% | * | 90d | 196 | 11 | 207 | 5% | * * Semanas com…
- **Eventos que ficam só na lista de inspeção "Erros recentes"** (`web/src/pages/AdminMetricsPage/overview.ts:133`): Eventos que ficam só na lista de inspeção "Erros recentes". * Não disparam o chip genérico do topo: login tem alerta proporcional próprio; * oauth_error é etapa anterior ao callback e também entra na inspeção.
- **O build de produção para quando VITE_API_URL ou VITE_AUTH_URL faltam ou estão // malformadas** (`web/vite.config.ts:61`): O build de produção para quando VITE_API_URL ou VITE_AUTH_URL faltam ou estão // malformadas. Dev e testes seguem com os padrões de config.ts.

#### Analytics e consentimento

- **O vitest stuba CSS (mesmo com ?raw), então a regra do banner do app // é guardada aqui, onde ler o a** (`web/build/guides.test.ts:469`): O vitest stuba CSS (mesmo com ?raw), então a regra do banner do app // é guardada aqui, onde ler o arquivo é permitido pelo type-check.
- **Não usar `source`: o GA4 trata esse parâmetro como origem da sessão** (`web/src/analytics/funnel.ts:32`): Não usar `source`: o GA4 trata esse parâmetro como origem da sessão.
- **O banner reaparece a cada 30 dias para quem recusou** (`web/src/analytics/ga.ts:46`): O banner reaparece a cada 30 dias para quem recusou. // Re-pedir com muita frequência (ex: 3 dias) é considerado "Consent Fatigue" e // pode ir contra o princípio de "consentimento livre" da LGPD/GDPR.
- **A recarga encerra os eventos automáticos do cliente já carregado** (`web/src/analytics/ga.ts:82`): A recarga encerra os eventos automáticos do cliente já carregado. A nova // página restaura denied e ga-disable antes de qualquer chamada do gtag.
- **O GTM exige estritamente o objeto `arguments` nativo** (`web/src/analytics/ga.ts:112`): O GTM exige estritamente o objeto `arguments` nativo. Se usarmos rest parameters // (...args), um Array é criado e o GTM ignora silenciosamente os eventos.
- **Carrega o gtag.js fora do caminho crítico de renderização** (`web/src/analytics/ga.ts:139`): Carrega o gtag.js fora do caminho crítico de renderização: o stub acima já // enfileira os hits em dataLayer, então o script real pode chegar depois do // load/idle sem perder nenhum evento — apenas adia ~165 KiB que não são // necessários para pintar a página (reduz o "JS não utilizado" do PageSpeed).
- **O que o GA4 recebe sobre a página atual** (`web/src/analytics/pageContext.ts:1`): O que o GA4 recebe sobre a página atual. * * Nome do grupo, id do grupo e código de convite são privados e não saem do * app. O título da aba continua com o nome do grupo: só o valor enviado ao GA * é genérico. Ele vem sempre da rota, nunca de `document.title`, porque a * função do convite reescreve o `<title>` do HTML com o nome do grupo, e esse * título so…
- **Grupos já calculados no hook no carregamento (fonte única de verdade)** (`web/src/components/CreateGroupModal/CreateGroupModal.tsx:57`): Grupos já calculados no hook no carregamento (fonte única de verdade); // sem um dos grupos não há <optgroup> — um título sozinho só adicionaria ruído.
- **O rótulo de exibição (`round_label`) vem pronto da API (`GET /matches`)** (`web/src/lib/rounds.ts:1`): O rótulo de exibição (`round_label`) vem pronto da API (`GET /matches`) — a fonte // única é o back (`api/src/matches/rounds.ts`). Aqui fica só a lógica client-side // que deriva do `round` cru e não tem por que ir ao servidor.
- **Folga de um dia: a retenção de 90 dias do Analytics Engine come o início da janela de 90d** (`web/src/pages/AdminMetricsPage/HeatmapSection.tsx:170`): Folga de um dia: a retenção de 90 dias do Analytics Engine come o início da janela de 90d.
- **Cadastros por origem no período** (`web/src/pages/AdminMetricsPage/SignupOriginsSection.tsx:5`): Cadastros por origem no período. Consome GET /metrics/signup-origins: eventos do * Analytics Engine com o total do D1 ao lado. A diferença aparece em linha própria, * sem ser encaixada numa categoria, porque é ela que mostra se a medição fecha.
- **Tradução dos event_type do Analytics Engine para linguagem de negócio** (`web/src/pages/AdminMetricsPage/labels.ts:1`): Tradução dos event_type do Analytics Engine para linguagem de negócio. * O nome cru continua sendo a chave do esquema posicional em * docs/observability.md — a UI mostra o rótulo e mantém o cru no tooltip.
- **Acervo completo do R2** (`web/src/pages/AdminMetricsPage/overview.ts:241`): Acervo completo do R2: estatísticas + eventos/mês. É a única visão que // enxerga além da janela de ~3 meses do Analytics Engine.

#### Rotas, hidratação e convite

- **Login URL carrying a `from` token** (`web/build/guides.ts:26`): Login URL carrying a `from` token. The guide pages are JS-less static HTML, so * the CTA click itself can't be tracked — instead the SPA reads `?from=` when the * login page mounts and fires a GA event (see pages/LoginPage). This is how we * attribute "which guide drove someone to sign in". * * `competicao` leva o slug da competição que vem escolhida no form…
- **Same env var the SPA reads (src/config.ts)** (`web/build/guides.ts:1155`): Same env var the SPA reads (src/config.ts). Vite loads .env.<mode> into // config.env, so production builds get the id and local dev stays GA-free.
- **Pages Function de `/convite/:code`** (`web/functions/convite/[code].ts:1`): Pages Function de `/convite/:code`: preview do link de convite. * * O WhatsApp (e Telegram, X, iMessage) monta o card do link lendo as meta tags * do HTML, sem executar JS. Esta Function devolve o mesmo `index.html` da SPA * com `<title>`, `og:*` e `twitter:*` trocados pelos dados do grupo, buscados no * endpoint público da API (`GET /public/invites/:code`).…
- **Mesmo formato validado pela API (api/src/public/router.ts)** (`web/functions/convite/[code].ts:85`, `web/src/lib/invite.ts:56`): Mesmo formato validado pela API (api/src/public/router.ts). Validar aqui poupa // a chamada quando o link vem truncado ou adulterado.
- **Crawlers que montam card de link** (`web/functions/convite/[code].ts:93`): Crawlers que montam card de link. A lista nomeada cobre os que não trazem // "bot" no nome (facebookexternalhit, WhatsApp, Embedly...); o `bot` genérico // pega o resto. Uma pessoa classificada como crawler fica sem `data-convite`, e a SPA busca o convite sozinha.
- **Uma abertura perdida não justifica atrasar nem derrubar o convite** (`web/functions/convite/[code].ts:362`): Uma abertura perdida não justifica atrasar nem derrubar o convite.
- **Se a reescrita falhar, devolve o index.html original e a SPA busca o convite** (`web/functions/convite/[code].ts:440`): Se a reescrita falhar, devolve o index.html original e a SPA busca o convite.
- **O `<style>` de um comentário HTML não roda** (`web/scripts/csp-verify.test.ts:143`): O `<style>` de um comentário HTML não roda: conferir o hash dele (e não o // do bloco real) publica na CSP um hash que a página nunca usa — foi o que // aconteceu com o CSS embutido da landing, que ficou fora da política.
- **Se o marcador mudar, o build precisa falhar em vez de publicar a casca vazia** (`web/scripts/prerender.mjs:66`): Se o marcador mudar, o build precisa falhar em vez de publicar a casca vazia: // um `index.html` sem a landing derruba o LCP de volta e ninguém perceberia.
- **O `data-prerender` é o sinal que `main.tsx` usa para escolher entre // `hydrateRoot` e `createRoot`** (`web/scripts/prerender.mjs:79`): O `data-prerender` é o sinal que `main.tsx` usa para escolher entre // `hydrateRoot` e `createRoot`; sem ele o React descartaria o HTML e remontaria // tudo, jogando fora o ganho de LCP.
- **LCP: a landing já está pintada no HTML do build e não depende da sessão, // então o primeiro render** (`web/src/App.test.tsx:376`): LCP: a landing já está pintada no HTML do build e não depende da sessão, // então o primeiro render precisa reproduzi-la — senão a hidratação diverge.
- **Quem já logou aqui vai para o dashboard** (`web/src/App.test.tsx:390`): Quem já logou aqui vai para o dashboard: o script inline do index.html // descarta a landing, o App recebe false e não pisca a página de marketing.
- **Dashboard admin de métricas server-side** (`web/src/App.tsx:51`): Dashboard admin de métricas server-side — sem link de navegação (URL direta); // a API restringe ao ADMIN_EMAIL, aqui é só rota.
- **`/convite/:code` é o link compartilhado (a Pages Function de mesmo caminho * cuida do preview no WhatsApp)** (`web/src/App.tsx:60`): `/convite/:code` é o link compartilhado (a Pages Function de mesmo caminho * cuida do preview no WhatsApp). Sem sessão, a rota mostra a InvitePage. Com * sessão, vira `/?convite=CODE`, onde o Dashboard abre o fluxo de entrada.
- **Sem pintura antecipada, seguimos com a tela escura pintada inline no // index.html até a rota aparecer** (`web/src/App.tsx:295`): Sem pintura antecipada, seguimos com a tela escura pintada inline no // index.html até a rota aparecer — nada de flash branco.
- **{/* Durante o loading não sabemos ainda se estas rotas são do visitante ou de um usuário logado, ent** (`web/src/App.tsx:318`): Durante o loading não sabemos ainda se estas rotas são do visitante ou de um usuário logado, então elas não pintam nada. */}
- **{/* Quem já tem sessão e toca no CTA de um guia vai ao painel com a mesma query** (`web/src/App.tsx:348`): Quem já tem sessão e toca no CTA de um guia vai ao painel com a mesma query. O `from` mantém a atribuição e o `competicao` abre a criação. Na volta pelo histórico até `/entrar`, o `competicao` fica de fora. A primeira rota do documento tem a chave `default` e é a única que corresponde ao tipo de carga do navegador. */}
- **Usa o matcher do React Router** (`web/src/analytics/pageContext.ts:60`): Usa o matcher do React Router: a regra de maiúsculas e de caminho codificado // precisa ser a mesma que abre a página.
- **{/* /privacidade é HTML estático gerado no build, fora das rotas do React** (`web/src/components/CookieConsent/CookieConsent.tsx:82`): /privacidade é HTML estático gerado no build, fora das rotas do React. */}
- **Nome sem espaços maior que o card quebra em vez de vazar** (`web/src/components/GroupCard/GroupCard.module.css:51`): Nome sem espaços maior que o card quebra em vez de vazar.
- **─── Rodapé do card encerrado** (`web/src/components/GroupCard/GroupCard.module.css:247`): ─── Rodapé do card encerrado: compartilhar resultado ────────────────────── Fora do link principal (botão aninhado é HTML inválido). Discreto — o convite a divulgar não deve competir com o pódio.
- **Só quem abriu `/convite/<código>` passou pela página que conta aberturas** (`web/src/components/JoinGroupModal/JoinGroupModal.tsx:27`): Só quem abriu `/convite/<código>` passou pela página que conta aberturas.
- **Com table-layout fixed, o cabeçalho define as larguras** (`web/src/components/LeaderboardTab/LeaderboardTab.module.css:7`): Com table-layout fixed, o cabeçalho define as larguras. As colunas numéricas não crescem, e a do nome fica com o espaço restante e corta o nome com reticências em vez de alargar a tabela.
- **A coluna da rodada encurta já no corte do celular** (`web/src/components/LeaderboardTab/LeaderboardTab.module.css:185`): A coluna da rodada encurta já no corte do celular. Com "Rodada 34" entre 481 e 600 px, o nome ficaria sem espaço ao lado das badges.
- **Switch to two columns as soon as two cards fit side by side at their minimum no-wrap width (505px ea** (`web/src/components/PredictionsTab/PredictionsTab.module.css:136`): Switch to two columns as soon as two cards fit side by side at their minimum no-wrap width (505px each), so cards never disagree in height. Math: 2×505 (cards) + 12 (grid gap, --space-3) + 48 (page padding, 2×--space-6) = 1070, +~10px scrollbar buffer. Below this, single column always fits.
- **Palpites do grupo para a classificação da rodada** (`web/src/components/PredictionsTab/RoundSummary.tsx:61`): Palpites do grupo para a classificação da rodada. É a mesma chamada da aba Grupo, sem * rota nova. Nos dois modos de visibilidade, a API só entrega palpite alheio de jogo * travado, e o resumo só usa jogo encerrado. Falha de rede deixa `null`, e o resumo * segue só com os dados do próprio usuário.
- **Home cards leem pending_predictions via fetchCachedJson (TTL 30s)** (`web/src/components/PredictionsTab/usePredictionsBulkSave.ts:247`): Home cards leem pending_predictions via fetchCachedJson (TTL 30s). // Sem invalidar, voltar à dashboard dentro do TTL mostra N antigo.
- **O aceito fica gravado em qualquer rodada** (`web/src/components/PredictionsTab/usePredictionsBulkSave.ts:252`): O aceito fica gravado em qualquer rodada. O convite de avaliação, como o // aviso, abre só na rodada em que o envio começou.
- **── Forma recente ("Últimas 4") ───────────────────────────────────────── Vitória usa o verde da marc** (`web/src/components/StandingsTab/StandingsTab.module.css:174`): ── Forma recente ("Últimas 4") ───────────────────────────────────────── Vitória usa o verde da marca (✓ preto, como todo conteúdo sobre primary); derrota precisa de um vermelho que o sistema não tem — local por enquanto.
- **A: 1 vitória e 1 derrota feia → 3 pts, 1 v, sg -4 // B** (`web/src/components/StandingsTab/StandingsTab.test.tsx:595`): A: 1 vitória e 1 derrota feia → 3 pts, 1 v, sg -4 // B: 3 empates → 3 pts, 0 v, sg 0. CBF: A acima de B (FIFA seria o oposto).
- **Maior atraso que o `setTimeout` aceita** (`web/src/hooks/useNow.ts:3`): Maior atraso que o `setTimeout` aceita. Acima dele o timer dispararia na hora.
- **Executa no jsdom os scripts inline do `index.html`, os mesmos que o navegador * roda antes do bundle** (`web/src/indexHtml.test.ts:5`): Executa no jsdom os scripts inline do `index.html`, os mesmos que o navegador * roda antes do bundle: o do `<head>` decide se a landing pré-renderizada fica * e, com sessão conhecida, reescreve `/convite/CODE` para `/?convite=CODE`; o do * fim do `<body>` esvazia o `#root` quando a landing não deve aparecer.
- **Link de convite de grupo** (`web/src/lib/invite.ts:1`): Link de convite de grupo. * * O formato atual é `/convite/<CODE>`: a Pages Function em * `functions/convite/[code].ts` responde essa rota com as meta tags Open Graph * do grupo (nome, campeonato, participantes), e é isso que o WhatsApp mostra no * preview. Na SPA, o visitante vê a página de convite nessa mesma URL e quem tem * sessão vai para `/?convite=<COD…
- **Chave duplicada no script inline do index.html, que descarta a landing na // volta do Google** (`web/src/lib/invite.ts:65`): Chave duplicada no script inline do index.html, que descarta a landing na // volta do Google. Se mudar aqui, mude lá também.
- **Fetch direto, porque a rota é pública e não há sessão para o apiFetch monitorar** (`web/src/lib/invitePreview.ts:68`): Fetch direto, porque a rota é pública e não há sessão para o apiFetch monitorar.
- **Foco na janela e volta da rede não disparam nova busca, como no fetchCachedJson** (`web/src/lib/queryClient.ts:5`): Foco na janela e volta da rede não disparam nova busca, como no fetchCachedJson.
- **Só `convite_link` passou pela página que conta aberturas** (`web/src/pages/AdminMetricsPage/InviteFunnelSection.tsx:34`): Só `convite_link` passou pela página que conta aberturas: link antigo fica fora da taxa.
- **Gráficos SVG do dashboard admin** (`web/src/pages/AdminMetricsPage/charts.tsx:4`): Gráficos SVG do dashboard admin — sem lib de chart de propósito (página de * 1 usuário não justifica dependência no bundle).
- **Sparkline do interesse diário** (`web/src/pages/AdminRadarPage/Sparkline.tsx:3`): Sparkline do interesse diário — a forma da curva importa mais que os valores * (torneio em alta sobe; torneio parado achata), por isso não tem eixo nem * rótulo. SVG puro, como o resto do admin: uma página de 1 usuário não * justifica lib de chart no bundle.
- **O CTA do guia pede uma competição em `?competicao=`** (`web/src/pages/DashboardPage/DashboardPage.tsx:254`): O CTA do guia pede uma competição em `?competicao=`. Na montagem, o painel // abre a criação com ela escolhida. Convite na URL tem prioridade.
- **Só quem tocou em "Entrar com Google e participar" nesta aba entra sem // confirmar** (`web/src/pages/DashboardPage/DashboardPage.tsx:275`): Só quem tocou em "Entrar com Google e participar" nesta aba entra sem // confirmar. Um link `?convite=` aberto sozinho continua pedindo o toque. // Fechar o modal descarta essa entrada: seguir o mesmo link de novo pede o toque.
- **Fechar o modal do convite consome o `?convite=`** (`web/src/pages/DashboardPage/DashboardPage.tsx:296`): Fechar o modal do convite consome o `?convite=`: recarregar a lista ou a página // não o reabre. Um novo link de convite volta a abrir o modal.
- **Se o convite é de um grupo em que o usuário já está, navega para o grupo em // vez de deixar o paine** (`web/src/pages/DashboardPage/DashboardPage.tsx:310`): Se o convite é de um grupo em que o usuário já está, navega para o grupo em // vez de deixar o painel parado com `?convite=` na URL.
- **{/* A chave recria o modal quando o convite sai da URL** (`web/src/pages/DashboardPage/DashboardPage.tsx:345`): A chave recria o modal quando o convite sai da URL: o código dispensado não fica no campo nem é reenviado ao abrir a entrada pela tela. */}
- **Grupo do convite em que o usuário já está** (`web/src/pages/DashboardPage/hooks/useDashboardGroups.ts:22`): Grupo do convite em que o usuário já está. A página navega direto para ele.
- **Convite na URL agora** (`web/src/pages/DashboardPage/hooks/useDashboardGroups.ts:26`): Convite na URL agora. Se ele saiu enquanto a lista carregava, a resposta não abre o modal.
- **Convite que sai da URL (dispensado ou aceito) não muda a lista** (`web/src/pages/DashboardPage/hooks/useDashboardGroups.ts:86`): Convite que sai da URL (dispensado ou aceito) não muda a lista: nada a buscar.
- **Linha compacta do celular** (`web/src/pages/GroupDetailPage/GroupDetailPage.module.css:267`): Linha compacta do celular. No desktop o convite fica sempre aberto e o botão some. O media query abaixo inverte.
- **Código trocado, de grupo excluído ou que nunca existiu** (`web/src/pages/InvitePage/InvitePage.tsx:108`): Código trocado, de grupo excluído ou que nunca existiu. O link de login cobre * quem tem acesso a um grupo de campeonato em piloto, que a rota pública trata * como inexistente. Depois do login, a entrada segue pelo modal do Dashboard.
- **Links para os guias estáticos (/guias/*), páginas fora da SPA** (`web/src/pages/LandingPage/LandingPage.tsx:262`): Links para os guias estáticos (/guias/*), páginas fora da SPA. * Usa <a> nativo porque o react-router não tem as rotas /guias/*.
- **{/* Static content pages live outside the SPA (built to /guias/*), so use a native <a> for a full navigation** (`web/src/pages/LandingPage/LandingPage.tsx:322`): Static content pages live outside the SPA (built to /guias/*), so use a native <a> for a full navigation — react-router has no such route. */}
- **{/* /privacidade é HTML estático gerado no build** (`web/src/pages/LoginPage/LoginPage.tsx:63`): /privacidade é HTML estático gerado no build: link nativo, fora do router. */}
- **Guarda de roteamento do Cloudflare Pages** (`web/src/routes.test.ts:9`): Guarda de roteamento do Cloudflare Pages. * * O Pages serve arquivos estáticos: sem uma regra em `public/_redirects`, uma * URL de rota client-side acessada direto (ou recarregada) devolve o 404.html * de verdade — o React Router nem chega a rodar. Como o `_redirects` lista as * rotas **explicitamente**, adicionar uma `<Route>` sem a regra correspondente * é…
- **A rota de coleta precisa ter precedência sobre o bloqueio geral** (`web/tests/e2e/cookie-consent-layout-real-gtag.spec.ts:34`): A rota de coleta precisa ter precedência sobre o bloqueio geral.
- **A página de grupo só aceita id no formato de UUID (#726)** (`web/tests/e2e/cookie-consent-layout.spec.ts:3`, `web/tests/e2e/error-screen.spec.ts:3`, `web/tests/e2e/group-admin.spec.ts:3` (+4)): A página de grupo só aceita id no formato de UUID (#726).
- **A LoginPage carrega sob demanda (c755b2d7), então a landing, com dois botões // do Google, fica na t** (`web/tests/e2e/landing.spec.ts:35`): A LoginPage carrega sob demanda (c755b2d7), então a landing, com dois botões // do Google, fica na tela até o chunk chegar. O título marca a troca de página.
- **O Pages aplica o `_headers` só aos assets** (`web/tests/functions/conviteHeaders.test.ts:7`): O Pages aplica o `_headers` só aos assets. A resposta de uma Function não * passa por ele, então a Function de convite precisa devolver os cabeçalhos de * segurança por conta própria. A regra `/*` do `_headers` é a referência: o * teste lê o arquivo e exige cada linha em todas as respostas da Function.

#### Guias, SEO e páginas estáticas

- **Optional FAQ block rendered after the sections, mirrored in a FAQPage * JSON-LD so search engines an** (`web/build/guides.ts:92`): Optional FAQ block rendered after the sections, mirrored in a FAQPage * JSON-LD so search engines and answer engines can quote it.
- **Replaces the default CTA copy and repeats the CTA right after the intro, for * guides whose reader a** (`web/build/guides.ts:97`): Replaces the default CTA copy and repeats the CTA right after the intro, for * guides whose reader arrives wanting to create a pool.
- **ISO date (YYYY-MM-DD) the guide first went live** (`web/build/guides.ts:109`): ISO date (YYYY-MM-DD) the guide first went live: Article `datePublished`. * Fixed forever. Taken from the commit on main that introduced the slug * (`git log --reverse --format=%as -S "slug: '<slug>'" -- web/build/guides.ts`). * A new guide uses the date of the commit that adds it.
- **ISO date (YYYY-MM-DD) of the last content edit** (`web/build/guides.ts:116`): ISO date (YYYY-MM-DD) of the last content edit: sitemap <lastmod> and * Article `dateModified`. Bump it whenever the guide's text changes; never * earlier than `published`.
- **Contextual internal links to the sibling guides** (`web/build/guides.ts:900`): Contextual internal links to the sibling guides — strengthens the topic // cluster for SEO and keeps the other pages from being orphaned.
- **privacidade.html: o Cloudflare Pages serve em /privacidade, sem barra final** (`web/build/guides.ts:1195`): privacidade.html: o Cloudflare Pages serve em /privacidade, sem barra final.
- **Per-guide dates stay manual (`updated`)** (`web/build/guides.ts:1256`): Per-guide dates stay manual (`updated`): granular and truthful — bump it // when you edit a guide's content.
- **Data manual, como a dos guias** (`web/build/guides.ts:1263`): Data manual, como a dos guias: mude `updated` em build/privacy.ts junto com o texto.
- **Uma página noindex com canonical apontando para a home manda sinais // contraditórios** (`web/functions/convite/[code].ts:271`): Uma página noindex com canonical apontando para a home manda sinais // contraditórios; sem canonical fica só o noindex.
- **Match the CTA tokens generated by build/guides.ts without importing build code** (`web/src/analytics/guideOrigin.ts:5`): Match the CTA tokens generated by build/guides.ts without importing build code.
- **Os guias são HTML estático, sem o app** (`web/src/analytics/signupOrigin.ts:65`): Os guias são HTML estático, sem o app: quem sai de um deles é atribuído pelo caminho.
- **Slug da competição que vem escolhida, pedido pelo link de um guia** (`web/src/components/CreateGroupModal/hooks/useCreateGroupForm.ts:15`): Slug da competição que vem escolhida, pedido pelo link de um guia. Vale * enquanto o pai passar o valor; o painel o descarta ao fechar o modal.
- **GoogleLoginButton styles** (`web/src/components/GoogleLoginButton/GoogleLoginButton.module.css:1`): GoogleLoginButton styles. * * Follows Google's Sign-In Button branding guidelines: * white background, Google G logo on the left, dark label text. * See: https://developers.google.com/identity/branding-guidelines * * The focus-visible ring uses --color-primary to stay on-brand.
- **Jogo adiado pelo provider** (`web/src/components/MatchCard/types.ts:7`): Jogo adiado pelo provider. O `start_time` continua sendo o horário original * (que já passou), então o card não pode se guiar só pela data — sem essa flag * ele mostraria "bloqueado / aguardando resultado" para sempre.
- **Slug pedido em `?competicao=` pelo CTA de um guia** (`web/src/pages/DashboardPage/DashboardPage.tsx:28`): Slug pedido em `?competicao=` pelo CTA de um guia. Vale só um parâmetro, com * até 100 caracteres, em minúsculas, números e hífens. Fora disso, o pedido é * ignorado.

#### Pages Functions, proxy e OG

- **Render the static 404 page** (`web/build/guides.ts:1102`): Render the static 404 page. Cloudflare Pages serves /404.html (with a real 404 * status) for any URL not matched by a static asset or a _redirects rule. It's * `noindex` so a crawler that lands on a stale link doesn't index an error page.
- **Proxy de `/api/*` para a API (`api.palpitae.com.br`)** (`web/functions/api/[[path]].ts:1`): Proxy de `/api/*` para a API (`api.palpitae.com.br`). * * O fetch daqui é um subrequest de Worker, e a API recebe o IP de saída da * Cloudflare em `CF-Connecting-IP`, igual para todo visitante. Para a quota por * IP das requisições anônimas, o proxy repassa o IP do visitante em * `X-Palpitae-Client-IP`, acompanhado do segredo compartilhado * `PROXY_SHARED_SE…
- **Cache de verdade no edge** (`web/functions/convite/[code].ts:162`): Cache de verdade no edge. O Cache-Control da API sozinho não basta, // porque subrequests de um Worker só passam pelo cache com `cf`. Erro e // 429 não entram (-1 é "não guardar"; 0 expira na hora), porque o 429 de // um visitante apareceria para os outros.
- **Crawler não roda JS, então o nome do admin fica fora do HTML dele** (`web/functions/convite/[code].ts:414`): Crawler não roda JS, então o nome do admin fica fora do HTML dele.
- **A contagem de palavras é a métrica que a auditoria de conteúdo do site usa // (limiar de 200 palavra** (`web/scripts/prerender.mjs:90`): A contagem de palavras é a métrica que a auditoria de conteúdo do site usa // (limiar de 200 palavras com mais de 1 caractere). Antes deste script ela era // atendida por um bloco estático escrito à mão no index.html; agora vem do // conteúdo real da página, então o número aparece no log do build.
- **Aplica a rodada padrão uma vez por grupo e competição enquanto a aba está montada** (`web/src/components/GroupPicksTab/useGroupPicksTab.ts:164`, `web/src/components/PredictionsTab/usePredictionsTab.ts:129`): Aplica a rodada padrão uma vez por grupo e competição enquanto a aba está montada. // Um refetch não troca a rodada escolhida. Com o cache velho em atualização, espera // o dado novo para a rodada padrão vir da resposta atual.
- **Anchor to the badge's right edge and grow leftwards** (`web/src/components/PenaltyBadge/PenaltyBadge.module.css:55`): Anchor to the badge's right edge and grow leftwards. The badge is always at the right of its row, so this keeps the tooltip on-screen — centering it overflowed the viewport and caused horizontal scroll.
- **Exige `pointer: coarse` porque navegadores de desktop também expõem `navigator.share`, * e ali o bot** (`web/src/components/ShareButtons/ShareButtons.tsx:28`): Exige `pointer: coarse` porque navegadores de desktop também expõem `navigator.share`, * e ali o botão abre o WhatsApp direto.
- **Cancelar o menu, ou tocar de novo com ele aberto (InvalidStateError), não abre // nada** (`web/src/components/ShareButtons/ShareButtons.tsx:50`): Cancelar o menu, ou tocar de novo com ele aberto (InvalidStateError), não abre // nada. Outra falha cai no link do WhatsApp.
- **Chrome e Edge antes da versão 119 ignoram `preventDefault()` e só mostram o // aviso quando `returnV** (`web/src/hooks/useBeforeUnloadWarning.ts:12`): Chrome e Edge antes da versão 119 ignoram `preventDefault()` e só mostram o // aviso quando `returnValue` recebe um valor, mesmo vazio.
- **Regressão issue #120 / R1** (`web/src/lib/groupsCacheAfterSave.test.ts:4`): Regressão issue #120 / R1: GET /groups fica 30s em fetchCachedJson * (`groups:list:user`). Após gravar palpites a home precisa refetchar; * sem invalidateApiCache('groups:') o N antigo permanece dentro do TTL.
- **null = no future round** (`web/src/lib/rounds.ts:15`): null = no future round; undefined = pre-deploy cache without the field. // Both cases fall back to the last round (preserves old behaviour).
- **Buraco de feed (jogo sem placar após kickoff + limiar) versus backlog de * pontuação (finished sem s** (`web/src/pages/AdminMetricsPage/BusinessSection.tsx:205`): Buraco de feed (jogo sem placar após kickoff + limiar) versus backlog de * pontuação (finished sem scored_at), por temporada. Quem tem pendência vem * primeiro; zeros continuam visíveis.
- **.tabs clips vertically (overflow-x** (`web/src/pages/GroupDetailPage/GroupDetailPage.module.css:468`): .tabs clips vertically (overflow-x: auto forces overflow-y to auto/hidden), so an outline drawn outside the box loses its top edge. Draw it inset.

#### UI de palpites e rodada

- **penalty = 1 em todos os presets (bônus aditivo, independente do placar exato)** (`web/src/components/CreateGroupModal/constants.ts:7`): penalty = 1 em todos os presets (bônus aditivo, independente do placar exato).
- **"Só vencedor": sem bônus por placar exato (points_exact = 0)** (`web/src/components/CreateGroupModal/constants.ts:10`): "Só vencedor": sem bônus por placar exato (points_exact = 0). Ativa a UI 1X2 // (Casa / Empate / Fora) no palpite.
- **O link do lembrete por e-mail abre `/grupos/:id?rodada=`** (`web/src/components/GoogleLoginButton/GoogleLoginButton.tsx:34`): O link do lembrete por e-mail abre `/grupos/:id?rodada=`. Sem o caminho, quem // entra por ele cai no painel depois do login.
- **Linha de status da rodada, abaixo dos stats e dentro do mesmo link do card** (`web/src/components/GroupCard/GroupCard.module.css:124`): Linha de status da rodada, abaixo dos stats e dentro do mesmo link do card. Todo card em andamento tem uma. Só a pendência ganha a cor da marca; ao vivo, rodada completa e sem jogos ficam discretos.
- **Linhas do card. Com o jogo travado, ou num grupo "Sempre visível", o card lista * todos os membros,** (`web/src/components/GroupPicksTab/GroupPicksTab.tsx:34`): Linhas do card. Com o jogo travado, ou num grupo "Sempre visível", o card lista * todos os membros, e quem não palpitou entra como "sem palpite". Num grupo com * palpites ocultos, enquanto o servidor não confirma o travamento, o card mostra só * o que a API devolveu, que é o palpite do próprio usuário. A API esconde os outros * palpites até lá, e listar todo…
- **A API lê os membros antes dos palpites e só devolve palpite de quem ainda é // membro na segunda leitura** (`web/src/components/GroupPicksTab/GroupPicksTab.tsx:55`): A API lê os membros antes dos palpites e só devolve palpite de quem ainda é // membro na segunda leitura. Um palpite de fora da lista só chega se a pessoa // voltou ao grupo entre as duas leituras, porque o palpite de quem sai fica no banco.
- **A draw pick is ambiguous on score alone in a knockout** (`web/src/components/GroupPicksTab/GroupPicksTab.tsx:181`): A draw pick is ambiguous on score alone in a knockout: the // penalty winner is what tells two equal scores apart.
- **No início do jogo, a resposta guardada ainda esconde os palpites dos outros** (`web/src/components/GroupPicksTab/useGroupPicksTab.ts:114`): No início do jogo, a resposta guardada ainda esconde os palpites dos outros. Num * grupo de palpites ocultos, a aba busca de novo na primeira virada do relógio depois * do início e, se a API ainda não travou, a cada tique por `REVEAL_RETRY_MS` a partir * dessa busca. Contar do início deixaria sem busca a aba que volta de segundo plano * depois do prazo.
- **"Rodada 34" em caixa alta precisa de mais largura que as outras colunas numéricas** (`web/src/components/LeaderboardTab/LeaderboardTab.module.css:40`): "Rodada 34" em caixa alta precisa de mais largura que as outras colunas numéricas.
- **Rodadas seguidas a partir das quais o selo de sequência aparece** (`web/src/components/LeaderboardTab/LeaderboardTab.tsx:31`): Rodadas seguidas a partir das quais o selo de sequência aparece.
- **Reis da rodada, os membros com a maior pontuação** (`web/src/components/LeaderboardTab/LeaderboardTab.tsx:34`): Reis da rodada, os membros com a maior pontuação. Sem pontos, ninguém. Empate coroa todos.
- **Pontos na rodada. Membro sem linha na resposta fica com o traço** (`web/src/components/LeaderboardTab/LeaderboardTab.tsx:96`): Pontos na rodada. Membro sem linha na resposta fica com o traço.
- **Adiado — cor de aviso para separar de "bloqueado"** (`web/src/components/MatchCard/MatchCard.module.css:54`): Adiado — cor de aviso para separar de "bloqueado": aqui o palpite segue aberto.
- **Resultado pendente (kickoff + 3 h sem placar)** (`web/src/components/MatchCard/MatchCard.module.css:61`): Resultado pendente (kickoff + 3 h sem placar). O texto do badge basta para * leitores de tela e daltonismo; a cor só reforça o aviso.
- **Estado do palpite num jogo aberto, à direita da data** (`web/src/components/MatchCard/MatchCard.module.css:71`): Estado do palpite num jogo aberto, à direita da data. O texto diz o estado, e a * cor reforça. Sem palpite fica em contorno amarelo. Alterado e não salvo fica em * amarelo cheio, porque a edição se perde se o usuário sair. Salvo fica em verde * com a marca de confirmação. Todos passam de 4,5:1 sobre a superfície do card.
- **Palpite salvo e sem mudança** (`web/src/components/MatchCard/MatchCard.module.css:396`): Palpite salvo e sem mudança. É estado, então não tem fundo de ação nem opacidade reduzida. O contorno vem por sombra interna para não mudar a altura do botão.
- **Inline penalty pick** (`web/src/components/MatchCard/MatchCard.module.css:472`): Inline penalty pick — sits at the right of the active control row, beside the * save button, so a draw-marked card stays the same height as a locked/finished * one. A ball icon flags it as a shootout. Once a winner is chosen it collapses * to a PenaltyBadge chip (.penaltyChipSlot) to keep the row compact.
- **In 1X2 mode the three outcome buttons fill the row, so the penalty pick drops to its own centred lin** (`web/src/components/MatchCard/MatchCard.module.css:495`): In 1X2 mode the three outcome buttons fill the row, so the penalty pick drops to its own centred line below them.
- **Em 320 px o card tem 246 px úteis e os dois steppers pedem 271 px** (`web/src/components/MatchCard/MatchCard.module.css:618`): Em 320 px o card tem 246 px úteis e os dois steppers pedem 271 px. Abaixo de * 360 px o card perde padding lateral, o campo do placar encolhe e os controles * ficam mais juntos. Os −/+ seguem com 44 px e os steppers cabem numa linha só.
- **`editable` é o contrário de `isMatchLocked` em api/src/matches/locking.ts para os // campos do jogo** (`web/src/components/MatchCard/MatchCard.test.tsx:813`): `editable` é o contrário de `isMatchLocked` em api/src/matches/locking.ts para os // campos do jogo. Essa função não lê o `locked` do palpite, e o PUT aceita o envio // sempre que ela devolve false. Nas linhas abaixo, o card oferece edição quando o PUT // aceita. Fora da matriz, o `locked` do palpite também fecha o jogo que não está adiado.
- **"falta pênalti" usa o contorno amarelo de "sem palpite"** (`web/src/components/MatchCard/MatchCard.tsx:24`): "falta pênalti" usa o contorno amarelo de "sem palpite". Os dois pedem uma escolha.
- **Kickoff + 3 h sem placar (não adiado)** (`web/src/components/MatchCard/MatchCard.tsx:87`): Kickoff + 3 h sem placar (não adiado): o feed atrasou. Mantém o placar // existente; só acrescenta o rótulo. Texto no badge, sem depender só de cor.
- **{/* display:contents wrapper** (`web/src/components/MatchCard/MatchCard.tsx:403`): display:contents wrapper — keeps the three buttons as flex children of .outcomeRow while giving them their own radiogroup, so the penalty radiogroup below is a sibling, never nested. */}
- **Durante o envio, campos e +/− ficam travados, como os botões de resultado e de // pênalti** (`web/src/components/MatchCard/MatchCard.tsx:516`): Durante o envio, campos e +/− ficam travados, como os botões de resultado e de // pênalti. Uma mudança no meio do envio seria trocada pelo placar da resposta.
- **{/* Palpite salvo e sem mudança mostra "Salvo", sem opacidade reduzida** (`web/src/components/MatchCard/MatchCard.tsx:540`): Palpite salvo e sem mudança mostra "Salvo", sem opacidade reduzida. O botão continua o mesmo elemento do clique ao "Salvo". Durante o envio e no "Salvo" ele usa `aria-disabled` no lugar de `disabled`, que tiraria o foco dele. `handleSave` ignora o clique nesses dois estados. */}
- **Instante em que o sync viu o jogo iniciado pela primeira vez (não é o horário * em que a bola rolou)** (`web/src/components/MatchCard/types.ts:13`): Instante em que o sync viu o jogo iniciado pela primeira vez (não é o horário * em que a bola rolou). Preenchido, o palpite fica travado mesmo que o jogo seja * suspenso ou remarcado depois (espelha api/src/matches/locking.ts).
- **Inclui placar e pênalti no mesmo PUT** (`web/src/components/MatchCard/useMatchCard.ts:181`): Inclui placar e pênalti no mesmo PUT. Invalida só após sucesso para a // home refetchar pending_predictions sem N stale do TTL de 30s.
- **Palpite salvo que agora pede o vencedor nos pênaltis, por mudança na ida, tem o // estado "falta pên** (`web/src/components/MatchCard/useMatchCard.ts:239`): Palpite salvo que agora pede o vencedor nos pênaltis, por mudança na ida, tem o // estado "falta pênalti" e segue com "Atualizar" desabilitado.
- **Nada faltando e nenhuma importação anterior** (`web/src/components/PredictionsTab/PredictionsImportBar.tsx:124`): Nada faltando e nenhuma importação anterior: o link recolhido mantém a opção // de copiar outro grupo por cima dos palpites daqui.
- **A confirmação de "Aplicar também em" e o aviso de palpite recusado no "Salvar todos" podem ocupar at** (`web/src/components/PredictionsTab/PredictionsTab.module.css:13`): A confirmação de "Aplicar também em" e o aviso de palpite recusado no "Salvar todos" podem ocupar até três linhas na barra fixa.
- **Cenário real do Brasileirão 2026** (`web/src/components/PredictionsTab/PredictionsTab.test.tsx:702`): Cenário real do Brasileirão 2026: a rodada 4 tem um Flamengo×Mirassol parado // desde fevereiro e a 21 tem 2 adiados de julho. O default é a 22. Avisar da // rodada 4 primeiro fazia o usuário pular 17 rodadas pra trás e só então // descobrir que a 21 também tinha.
- **Avisa sobre UMA rodada com palpite aberto fora de hora** (`web/src/components/PredictionsTab/PredictionsTab.tsx:147`): Avisa sobre UMA rodada com palpite aberto fora de hora: a mais próxima ANTES // da aberta (ADR-013 e ADR-019). Se a rodada exibida é uma delas, não há aviso.
- **{/* Atalho para a rodada com jogo adiado ou remarcado** (`web/src/components/PredictionsTab/PredictionsTab.tsx:234`): Atalho para a rodada com jogo adiado ou remarcado. Sem isso o palpite aberto fica invisível: a rodada não é o default e o usuário não tem por que visitá-la. */}
- **Resposta de outra rodada não vale** (`web/src/components/PredictionsTab/RoundSummary.tsx:103`): Resposta de outra rodada não vale: mostraria zeros até a nova chegar.
- **Cada rodada exibida ganha um número** (`web/src/components/PredictionsTab/usePredictionsBulkSave.ts:109`): Cada rodada exibida ganha um número. O envio guarda o número da rodada em que // começou, e a resposta que volta depois da troca não mostra aviso na rodada nova.
- **Cancel the savedAll feedback timer and reset savedAll when the round changes, // and on unmount** (`web/src/components/PredictionsTab/usePredictionsBulkSave.ts:113`): Cancel the savedAll feedback timer and reset savedAll when the round changes, // and on unmount — otherwise a stale timeout can fire after a second save, // flipping savedAll back off (or on) at the wrong time. O aviso de erro ou de // palpite recusado também é da rodada anterior e sai junto.
- **Confirmações de sucesso mostradas neste contexto** (`web/src/components/PredictionsTab/usePredictionsReplicate.ts:67`): Confirmações de sucesso mostradas neste contexto. Saem do contexto quando a // pessoa troca de rodada ou de grupo; numa rodada sem jogo aberto, a opção some e // não haveria como tirá-las da barra. // A troca de contexto vem antes do registro do que a tela mostra.
- **Aviso depois da importação** (`web/src/components/PredictionsTab/usePredictionsTab.ts:91`): Aviso depois da importação. Com palpite importado, o aviso "Palpites importados * de <grupo>." já confirma o sucesso. Aqui fica só o que ele não diz.
- **A rodada do link fica fora das dependências da busca** (`web/src/components/PredictionsTab/usePredictionsTab.ts:126`): A rodada do link fica fora das dependências da busca. Quando o `?rodada=` sai // da URL, a aba não busca de novo nem volta para a rodada padrão.
- **Junta a listagem `fetched` ao que está na tela** (`web/src/components/PredictionsTab/usePredictionsTab.ts:195`): Junta a listagem `fetched` ao que está na tela. Os jogos de `savedSince` foram * salvos depois que a listagem foi pedida: o palpite da tela é mais novo que o * dela e fica. Nos outros jogos vale a listagem.
- **Grupo "só vencedor" não é origem para grupo de placar exato** (`web/src/components/PredictionsTab/usePredictionsTab.ts:301`): Grupo "só vencedor" não é origem para grupo de placar exato: a API recusa, porque // o 1x0 do botão não é um placar palpitado. Ausência de `points_exact` no irmão // (lista incompleta) conta como placar exato — o default de criação do grupo —, // para não esconder uma origem só porque o campo faltou no payload.
- **Import altera pending_predictions do grupo alvo na home** (`web/src/components/PredictionsTab/usePredictionsTab.ts:366`): Import altera pending_predictions do grupo alvo na home.
- **A replicação pertence à rodada dos jogos salvos** (`web/src/components/PredictionsTab/usePredictionsTab.ts:518`): A replicação pertence à rodada dos jogos salvos. Um "Salvar todos" pode terminar // depois que a tela passou para outra rodada.
- **Usa `isMatchLocked`, a regra de `collectRoundDrafts`** (`web/src/components/PredictionsTab/usePredictionsTab.ts:558`): Usa `isMatchLocked`, a regra de `collectRoundDrafts`. Sem jogo aberto na rodada // exibida, a barra "Salvar todos" sai da tela. Ela fica enquanto um envio está em // andamento, mostra o erro dele e leva a confirmação de "Aplicar também em".
- **round -> nº de jogos adiados** (`web/src/components/RoundHeader/RoundHeader.tsx:15`): round -> nº de jogos adiados. Marca a opção no seletor, senão a rodada * some da vista: ela não é o default (o adiado guarda o horário original, * já passado) mas ainda tem palpite aberto. Ver ADR-013.
- **round -> nº de jogos remarcados para o futuro numa rodada que ficou para * trás (fora do default_rou** (`web/src/components/RoundHeader/RoundHeader.tsx:21`): round -> nº de jogos remarcados para o futuro numa rodada que ficou para * trás (fora do default_round, ver api/src/matches/defaultRound.ts).
- **Espelha o back: round_label deriva do round (numérico → "Rodada N"), salvo // override explícito** (`web/src/components/matchFixtures.ts:9`): Espelha o back: round_label deriva do round (numérico → "Rodada N"), salvo // override explícito. Mantém os options do select coerentes nos testes.
- **Jogo adiado que o sync já viu iniciado (`locked_at`) está travado** (`web/src/hooks/useMatchRounds.ts:41`): Jogo adiado que o sync já viu iniciado (`locked_at`) está travado: não entra // na dica de "palpite segue aberto".
- **Status de cada grupo no painel, ordem por urgência e faixa "Próximo prazo"** (`web/src/lib/dashboardStatus.ts:1`): Status de cada grupo no painel, ordem por urgência e faixa "Próximo prazo". // Os números vêm prontos do `GET /groups`, calculados em // api/src/groups/pendingPredictions.ts pela mesma regra de rodada padrão da aba // Palpitar. Aqui fica só a escolha da mensagem, a ordem e o texto, com horários // no fuso de Brasília como no resto do app.
- **Palpite da ida no referencial da ida** (`web/src/lib/mataMataVectors.ts:25`): Palpite da ida no referencial da ida. * Usado só quando `role` é `leg2`; `null` quando ausente. * Nos demais papéis o campo não entra no cálculo (pode vir preenchido só para * provar que a ida o ignora).
- **O PUT aceita esse jogo** (`web/src/lib/predictionDrafts.test.ts:93`): O PUT aceita esse jogo: `isMatchLocked` da API não lê o `locked` do palpite.
- **Palpite salvo que pede o vencedor nos pênaltis e não tem essa escolha** (`web/src/lib/roundProgress.ts:14`): Palpite salvo que pede o vencedor nos pênaltis e não tem essa escolha. Acontece * na volta quando a ida muda e o agregado passa a empatar. O card mostra "falta * pênalti". A ida vem dos palpites salvos, porque o contador conta só o que está * salvo.
- **Os grupos em andamento seguem a ordem de urgência, com o jogo sem palpite que // fecha antes no topo** (`web/src/pages/DashboardPage/DashboardPage.tsx:135`): Os grupos em andamento seguem a ordem de urgência, com o jogo sem palpite que // fecha antes no topo. Encerrados mantêm a ordem da API.
- **Rodada pedida pela faixa "Próximo prazo" do painel** (`web/src/pages/GroupDetailPage/hooks.ts:60`): Rodada pedida pela faixa "Próximo prazo" do painel. Ela vale uma vez. A aba // Palpitar chama `clearRequestedRound` depois de abrir nela, e a troca de aba // também tira o parâmetro. Recarregar ou voltar à aba abre a rodada padrão.
- **Srcset da captura de palpites** (`web/src/pages/LandingPage/LandingPage.tsx:352`): Srcset da captura de palpites. No celular a captura ocupa a largura da tela * menos o padding da seção (100vw - 3rem), e no desktop fica na coluna de 1fr * do grid (456px com a seção no máximo de 1100px). A variante de 640w cobre as * duas larguras de exibição em DPR 1; com o DPR 2,6 do celular o navegador * escolhe a de 1100w.

#### Grupos e competições na UI

- **Button label. Must not name a competition the sign-up flow can't select** (`web/build/guides.ts:70`): Button label. Must not name a competition the sign-up flow can't select.
- **Slug em `competitions.slug`, no formato `<nome>-<temporada>`** (`web/build/guides.ts:102`): Slug em `competitions.slug`, no formato `<nome>-<temporada>`. O CTA * principal e o "Criar bolão" do topo pedem esse slug para vir escolhido no * formulário de criação. Sem essa competição na lista, o formulário fica na * primeira e mostra um aviso.
- **O corpo muda a cada grupo** (`web/functions/convite/[code].ts:315`): O corpo muda a cada grupo; validadores do index.html não servem mais.
- **O caminho cru entra na comparação porque dois grupos têm a mesma URL normalizada** (`web/src/analytics/useGaPageView.ts:17`): O caminho cru entra na comparação porque dois grupos têm a mesma URL normalizada.
- **A listagem de competições agora passa por apiFetch** (`web/src/components/CreateGroupModal/hooks/useCreateGroupForm.test.ts:340`): A listagem de competições agora passa por apiFetch; o POST /groups é que // não pode acontecer.
- **Cada abertura do formulário tem um número** (`web/src/components/CreateGroupModal/hooks/useCreateGroupForm.ts:49`): Cada abertura do formulário tem um número. Fechar o modal troca o número, e a // resposta de um envio feito antes não mexe no formulário reaberto. O envio em // andamento fica num ref para que um segundo submit, antes do novo render, não // crie outro grupo.
- **O padrão é a competição pedida pelo link, se ela estiver na lista // selecionável, ou a primeira da lista** (`web/src/components/CreateGroupModal/hooks/useCreateGroupForm.ts:56`): O padrão é a competição pedida pelo link, se ela estiver na lista // selecionável, ou a primeira da lista. Quando ela fica fora da lista, por // falta de cadastro ou porque a competição está encerrada, o modal mostra um // aviso junto do select.
- **Bônus de pênalti só aparece quando a competição escolhida tem fases que vão a // pênalti em jogo úni** (`web/src/components/CreateGroupModal/hooks/useCreateGroupForm.ts:67`): Bônus de pênalti só aparece quando a competição escolhida tem fases que vão a // pênalti em jogo único (Decisão 4) — senão o campo não faz sentido.
- **Encerradas saem; em andamento entram primeiro no select e são o // default** (`web/src/components/CreateGroupModal/hooks/useCreateGroupForm.ts:80`): Encerradas saem; em andamento entram primeiro no select e são o // default — campeonato prestes a virar só fallback. Os grupos saem // daqui uma única vez; o modal não reparticiona a lista.
- **O grupo existe mesmo que o modal tenha fechado** (`web/src/components/CreateGroupModal/hooks/useCreateGroupForm.ts:156`): O grupo existe mesmo que o modal tenha fechado: a tela de pronto só vale // para o formulário que enviou, mas o pai ainda recebe `onCreated` (o painel recarrega a lista).
- **Até 480 px, a tabela usa rótulos curtos, colunas numéricas estreitas e badges menores abaixo do nome** (`web/src/components/LeaderboardTab/LeaderboardTab.module.css:202`): Até 480 px, a tabela usa rótulos curtos, colunas numéricas estreitas e badges menores abaixo do nome, para caber sem rolagem horizontal.
- **Em 320 px o nome longo corta com reticências e os selos quebram linha dentro da célula, sem forçar r** (`web/src/components/LeaderboardTab/LeaderboardTab.module.css:255`): Em 320 px o nome longo corta com reticências e os selos quebram linha dentro da célula, sem forçar rolagem horizontal da tabela.
- **Espera as duas respostas para a tabela não ganhar uma coluna depois de aparecer** (`web/src/components/LeaderboardTab/LeaderboardTab.tsx:157`): Espera as duas respostas para a tabela não ganhar uma coluna depois de aparecer.
- **Grupo da última importação feita nesta visita** (`web/src/components/PredictionsTab/usePredictionsTab.ts:316`): Grupo da última importação feita nesta visita. A API guarda só o marcador // `import_completed`, então ao recarregar a origem não é mais conhecida.
- **Team column is the only flexible one** (`web/src/components/StandingsTab/StandingsTab.module.css:106`): Team column is the only flexible one; under table-layout: fixed it absorbs the same remainder in every group's table, so the numeric columns line up.
- **Competições elegíveis à aba Tabela (liga ou cup regional canônica) podem // chegar sem partidas das** (`web/src/components/StandingsTab/StandingsTab.tsx:254`): Competições elegíveis à aba Tabela (liga ou cup regional canônica) podem // chegar sem partidas das fases de classificação; cups inelegíveis seguem // com a mensagem de ausência de fase de grupos.
- **Fases de pontos cujo group_name na ESPN é parcial/incompleto** (`web/src/lib/standings.ts:17`): Fases de pontos cujo group_name na ESPN é parcial/incompleto: todos os jogos * da fase vão para um ranking geral (não inventa A/B nem omite null).
- **Competições cuja fase GROUP_STAGE usa ranking geral (grupos ESPN incompletos)** (`web/src/lib/standings.ts:23`): Competições cuja fase GROUP_STAGE usa ranking geral (grupos ESPN incompletos). * Seleção por código canônico (competitions.external_id); não globaliza GROUP_STAGE.
- **Copas regionais com classificação de pontos implementada na StandingsTab** (`web/src/lib/standings.ts:29`): Copas regionais com classificação de pontos implementada na StandingsTab. * Identidade por `competitions.external_id`; não abre Tabela para toda cup.
- **LEAGUE ('') = tabela única (REGULAR_SEASON / LEAGUE_PHASE)** (`web/src/lib/standings.ts:252`): LEAGUE ('') = tabela única (REGULAR_SEASON / LEAGUE_PHASE). GENERAL_RANKING // = Taça Guanabara / Gaúcho classificatória com grupos ESPN incompletos — // junta todos os jogos da fase. Demais fases: agrupa por group_name e // ignora mata-mata (group_name null fora das fases de pontos acima). // Ordem cronológica: a coluna de forma depende de "mais recente por…
- **Mapa de calor 7×24: tabela de largura fixa, rola na horizontal no celular** (`web/src/pages/AdminMetricsPage/AdminMetricsPage.module.css:285`): Mapa de calor 7×24: tabela de largura fixa, rola na horizontal no celular.
- **A tabela do arquivo R2 é montada a partir da data corrente (ontem pra trás), // então a chave do moc** (`web/src/pages/AdminMetricsPage/AdminMetricsPage.test.tsx:57`): A tabela do arquivo R2 é montada a partir da data corrente (ontem pra trás), // então a chave do mock precisa ser relativa a "ontem" de verdade.
- **totals só lista event_types presentes no período (GROUP BY)** (`web/src/pages/AdminMetricsPage/overview.ts:208`): totals só lista event_types presentes no período (GROUP BY); ausência de // login_success é zero legítimo, não "dado faltando".
- **Ausentes numa API anterior ao snapshot por campeonato** (`web/src/pages/AdminMetricsPage/types.ts:50`): Ausentes numa API anterior ao snapshot por campeonato — a página cai no // top 10 legado (`topCompetitions`) enquanto o deploy da API não chega.
- **Tabela larga: rola dentro da própria seção em telas estreitas** (`web/src/pages/AdminRadarPage/AdminRadarPage.module.css:75`): Tabela larga: rola dentro da própria seção em telas estreitas.
- **Recorte de status. "A começar" é uma pergunta de produto diferente de "está * rolando"** (`web/src/pages/AdminRadarPage/AdminRadarPage.tsx:56`): Recorte de status. "A começar" é uma pergunta de produto diferente de "está * rolando": dá o tempo de preparação para entrar numa competição antes da bola * rolar, que é quando o grupo se forma.
- **Veredito por competição** (`web/src/pages/AdminRadarPage/AdminRadarPage.tsx:107`): Veredito por competição — a leitura que a tela existe pra dar. Deliberadamente * grosseiro: é gatilho de investigação, não decisão automática.
- **Sem artigo mapeado = sem sinal de interesse** (`web/src/pages/AdminRadarPage/AdminRadarPage.tsx:205`): Sem artigo mapeado = sem sinal de interesse. É a fila de curadoria de // `api/src/radar/articles.ts`, por isso fica visível em vez de escondida. // Inclui as que vão começar: competição não mapeada prestes a estrear é ainda // mais urgente de medir do que uma já em curso.
- **Grupos de campeonatos encerrados** (`web/src/pages/DashboardPage/DashboardPage.tsx:102`): Grupos de campeonatos encerrados. Ficam numa seção própria, abaixo dos ativos, * colapsável — o resultado ainda é a parte mais empolgante logo após o fim, então * abre por padrão, mas o usuário pode recolher para tirar do caminho.
- **Deixamos o modal aberto com a tela de sucesso ("Pronto")** (`web/src/pages/DashboardPage/DashboardPage.tsx:284`): Deixamos o modal aberto com a tela de sucesso ("Pronto"). O `CreateGroupModal` // cuida do próprio estado de finalização.
- **O fade só aparece do lado em que há aba escondida** (`web/src/pages/GroupDetailPage/GroupDetailPage.module.css:416`): O fade só aparece do lado em que há aba escondida. GroupTabs define --fade-start e --fade-end.

#### Acessibilidade e CSS

- **Caminho numa variável** (`web/build/guides.test.ts:380`): Caminho numa variável: o Vite reescreve `new URL(`...${x}`, import.meta.url)` // literal como import de asset, e a leitura apontaria para outro lugar.
- **O aviso fica montado durante a nova tentativa, para o foco não sair do botão** (`web/src/App.tsx:210`): O aviso fica montado durante a nova tentativa, para o foco não sair do botão.
- **{/* `aria-disabled` no lugar de `disabled`** (`web/src/components/AuthUnavailable/AuthUnavailable.tsx:21`): `aria-disabled` no lugar de `disabled`: botão desabilitado perde o foco. */}
- **Tamanho e cor mudam por variáveis na classe de quem usa o avatar, sem * disputa de especificidade co** (`web/src/components/Avatar/Avatar.module.css:1`): Tamanho e cor mudam por variáveis na classe de quem usa o avatar, sem * disputa de especificidade com este arquivo.
- **{/* Array.from separa por ponto de código e não parte o emoji ao meio** (`web/src/components/Avatar/Avatar.tsx:40`): Array.from separa por ponto de código e não parte o emoji ao meio. */}
- **A badge de competição é lime-cheia no card ativo** (`web/src/components/GroupCard/GroupCard.module.css:178`): A badge de competição é lime-cheia no card ativo; num card mudo ela gritaria, então vira contorno discreto.
- **Uma linha só: logo, dois botões-ícone (alvo de 44 px) e o avatar** (`web/src/components/Header/Header.module.css:135`): Uma linha só: logo, dois botões-ícone (alvo de 44 px) e o avatar. * A classe global .sr-only-mobile tira o texto dos botões da tela e o mantém na árvore de * acessibilidade, então o nome acessível é o mesmo do desktop. * Altura: 8 + 44 + 8 + 1 (borda) = 61 px.
- **Seta da variação de posição** (`web/src/components/LeaderboardTab/LeaderboardTab.tsx:109`): Seta da variação de posição. 0 e `null` não mostram nada.
- **Sem a flag, `new Date() >= start_time` travaria o card para sempre** (`web/src/components/MatchCard/MatchCard.test.tsx:779`): Sem a flag, `new Date() >= start_time` travaria o card para sempre — o jogo // ainda vai ser disputado, então os inputs precisam continuar ativos.
- **Campo vazio viraria 0 em `Number('')` e gravaria um 0×0 que ninguém escolheu** (`web/src/components/MatchCard/useMatchCard.ts:325`): Campo vazio viraria 0 em `Number('')` e gravaria um 0×0 que ninguém escolheu.
- **O autoFocus de um campo roda no commit, antes de qualquer efeito** (`web/src/components/Modal/Modal.tsx:29`): O autoFocus de um campo roda no commit, antes de qualquer efeito. Só durante o // render o foco ainda está no elemento que abriu o modal.
- **Quando informado, o clique executa esta ação e o chip não tem tooltip** (`web/src/components/PenaltyBadge/PenaltyBadge.tsx:21`): Quando informado, o clique executa esta ação e o chip não tem tooltip; o * texto fica só no `aria-label`. Usado pelo chip editável para reabrir a escolha.
- **Compostos com .saveAllBar para vencer a base do Button (2 classes > 1) sem depender da ordem de inje** (`web/src/components/PredictionsTab/PredictionsTab.module.css:98`): Compostos com .saveAllBar para vencer a base do Button (2 classes > 1) sem depender da ordem de injeção dos CSS Modules.
- **Compostos com .importBar para vencer as bases de Select/Button (2 classes > 1) sem depender da ordem** (`web/src/components/PredictionsTab/PredictionsTab.module.css:164`): Compostos com .importBar para vencer as bases de Select/Button (2 classes > 1) sem depender da ordem de injeção dos CSS Modules.
- **Com 24 px de altura, o link atinge a área de toque mínima da WCAG 2.5.8** (`web/src/components/PredictionsTab/PredictionsTab.module.css:196`): Com 24 px de altura, o link atinge a área de toque mínima da WCAG 2.5.8.
- **Escopado sob .roundNav para vencer a base .select do componente Select (2 classes > 1) sem depender** (`web/src/components/tab-shared.module.css:37`): Escopado sob .roundNav para vencer a base .select do componente Select (2 classes > 1) sem depender da ordem de injeção dos CSS Modules.
- **O relógio do sistema pode estar alguns ms atrás do timer** (`web/src/hooks/useNow.ts:36`): O relógio do sistema pode estar alguns ms atrás do timer. Sem o `max`, a hora // ficaria antes do início e o card só travaria no intervalo seguinte.
- **Abortar um GET já enviado não economiza leitura no D1 e faria a próxima aba refazer a busca** (`web/src/lib/competitionMatches.ts:38`): Abortar um GET já enviado não economiza leitura no D1 e faria a próxima aba refazer a busca.
- **{/* blobs posicionais variam por tipo de evento** (`web/src/pages/AdminMetricsPage/AdminMetricsPage.tsx:467`): blobs posicionais variam por tipo de evento — mostra cru */}
- **Amostra par: média dos dois centrais** (`web/src/pages/AdminRadarPage/AdminRadarPage.tsx:136`): Amostra par: média dos dois centrais. Pegar só o de cima inflaria a régua // justamente quando há poucas competições medidas.
- **O item some ao fechar o menu** (`web/src/pages/GroupDetailPage/GroupHeader.tsx:71`): O item some ao fechar o menu. O foco vai ao botão do menu para o Modal devolvê-lo ali.
- **Apontar para /index.html faz o Pages detectar loop e desligar a regra // silenciosamente** (`web/src/routes.test.ts:56`): Apontar para /index.html faz o Pages detectar loop e desligar a regra // silenciosamente; um 301/302 trocaria a URL na barra do usuário.
- **Foco visível por padrão em todo controle (WCAG 2.4.7 e 1.4.11)** (`web/src/styles/global.css:72`): Foco visível por padrão em todo controle (WCAG 2.4.7 e 1.4.11). O verde da marca tem mais de 10:1 contra os fundos. Componentes só ajustam o recuo.
- **O vite.config libera só variables.css do esvaziamento de CSS nos testes** (`web/src/styles/tokens.test.ts:3`): O vite.config libera só variables.css do esvaziamento de CSS nos testes.
- **Com o card largo, o campeonato cabe numa linha** (`web/tests/e2e/group-card-layout.spec.ts:133`): Com o card largo, o campeonato cabe numa linha. Um max-width estreito na // badge voltaria a quebrar o nome.
- **tests/e2e são specs do Playwright (`npx playwright test`)** (`web/vite.config.ts:20`): tests/e2e são specs do Playwright (`npx playwright test`) — o vitest não // sabe executá-los e quebraria o `npm test`.
- **No PR, o Deploy Web roda só os testes que alcançam o diff pelo grafo de // imports (scripts/test-changed.sh)** (`web/vite.config.ts:29`): No PR, o Deploy Web roda só os testes que alcançam o diff pelo grafo de // imports (scripts/test-changed.sh). Uma mudança nestes arquivos, entre eles // o próprio script de seleção e o workflow que o chama, roda a suíte inteira. // O Vitest compara caminhos absolutos do repositório inteiro, então os // padrões ficam presos à web: o padrão `**/package.json` r…

#### Build e testes

- **O runner público do GitHub tem 4 vCPUs** (`web/playwright.config.ts:15`): O runner público do GitHub tem 4 vCPUs. Fora do CI, o padrão do Playwright.
- **O Vite reescreve o <style> inline no build** (`web/scripts/csp-verify.test.ts:166`): O Vite reescreve o <style> inline no build; esse hash só o csp:verify confere.
- **Import dinâmico: o módulo só existe depois do build SSR, e as funções // exportadas acima precisam p** (`web/scripts/prerender.mjs:60`): Import dinâmico: o módulo só existe depois do build SSR, e as funções // exportadas acima precisam poder ser importadas por testes sem o build.
- **jsdom não expõe a Navigation Timing API** (`web/src/App.test.tsx:126`): jsdom não expõe a Navigation Timing API; a propriedade própria some no fim.
- **O jsdom não aplica as media queries, e o Vitest carrega só os nomes de classe, // sem o CSS** (`web/src/components/PredictionsTab/PredictionsTab.controls.test.tsx:265`): O jsdom não aplica as media queries, e o Vitest carrega só os nomes de classe, // sem o CSS. O teste confere que os −/+ usam a classe que essas regras miram.
- **O pacote web não declara @types/node (type-check do CI roda só em web/)** (`web/src/lib/copiaVectors.test.ts:13`, `web/src/lib/mataMataVectors.test.ts:16`): O pacote web não declara @types/node (type-check do CI roda só em web/). // O Vitest resolve `node:fs` em runtime; o JSON fica na raiz do monorepo.
- **Alfabeto de `generateInviteCode` na API (sem I, O, 0 e 1)** (`web/src/lib/invite.ts:29`): Alfabeto de `generateInviteCode` na API (sem I, O, 0 e 1). Global para achar // todas as ocorrências e ficar com a última.
- **Importação `?raw` do Vite em vez de node:fs de propósito** (`web/src/routes.test.ts:2`): Importação `?raw` do Vite em vez de node:fs de propósito: o tsconfig do web // não inclui os tipos do Node, e o `type-check` do CI roda com `npm ci` apenas // dentro de web/ — usar `node:fs` aqui compila na máquina de quem tem // @types/node num node_modules acima e quebra o build no CI.
- **Lê com `?raw` do Vite porque o tsconfig do web não inclui os tipos do Node** (`web/tests/functions/conviteHeaders.test.ts:3`): Lê com `?raw` do Vite porque o tsconfig do web não inclui os tipos do Node.
- **Node >= 25 liga Web Storage por padrão** (`web/vite.config.ts:24`): Node >= 25 liga Web Storage por padrão; sem arquivo o localStorage global // fica quebrado e o jsdom não o substitui. Desliga o experimental para o // jsdom instalar o Storage de verdade (spies em Storage.prototype seguem // funcionando).

#### Outras (web)

- **A Copa do Mundo 2026 terminou** (`web/build/guides.test.ts:334`): A Copa do Mundo 2026 terminou. Texto público que cita essa edição precisa * estar no passado, e nenhum texto pode apresentar a Copa como campeonato * disponível no app. * * A regex `terminou|encerrad` é intencional: toda frase que cita a Copa 2026 * precisa conter um desses verbos no passado. Ao reescrever esses textos, * mantenha um deles na mesma frase ou …
- **Mesmo valor configurado no Worker da API** (`web/functions/api/[[path]].ts:25`, `web/functions/convite/[code].ts:49`): Mesmo valor configurado no Worker da API. Sem ele, o IP não é repassado.
- **Tipos mínimos do runtime de Pages/Workers** (`web/functions/convite/[code].ts:39`): Tipos mínimos do runtime de Pages/Workers. A pasta functions/ não entra no // tsconfig do app (que usa os tipos do DOM), então declaramos só o que é usado.
- **Headers de pré-busca do navegador** (`web/functions/convite/[code].ts:99`): Headers de pré-busca do navegador. Quem pré-busca ainda não abriu o link, e a // presença de qualquer um deles basta.
- **Todo navegador se apresenta assim** (`web/functions/convite/[code].ts:103`): Todo navegador se apresenta assim. Biblioteca HTTP e User-Agent vazio não.
- **O index.html referencia os assets com hash do deploy atual** (`web/functions/convite/[code].ts:318`): O index.html referencia os assets com hash do deploy atual; não guardar.
- **Para não depender dos cabeçalhos que o asset traz, toda saída, inclusive a do // asset com erro ou r** (`web/functions/convite/[code].ts:420`): Para não depender dos cabeçalhos que o asset traz, toda saída, inclusive a do // asset com erro ou redirect, leva os cabeçalhos de segurança.
- **URL pura, sem os headers do visitante** (`web/functions/convite/[code].ts:427`): URL pura, sem os headers do visitante: um If-None-Match repassado poderia // voltar 304 sem corpo, e o HTML reescrito sairia vazio.
- **Uma nova tentativa grava o trace (`on-first-retry`), mas o teste que só passa // nela reprova a execução** (`web/playwright.config.ts:11`): Uma nova tentativa grava o trace (`on-first-retry`), mas o teste que só passa // nela reprova a execução: instabilidade aparece no PR em vez de ficar escondida.
- **Comentários HTML e blocos `<script>`/`<style>` numa única passada** (`web/scripts/csp-verify.mjs:97`): Comentários HTML e blocos `<script>`/`<style>` numa única passada. Comentar * antes das tags evita o falso positivo de capturar um `<style>` (ou um * `<script>`) que aparece dentro de um comentário — ex.: `<!-- <style>… -->` — * como se fosse conteúdo real da página.
- **Uma vez por carga de página** (`web/src/App.tsx:168`): Uma vez por carga de página: o referrer não muda nas navegações internas.
- **Aviso de expiração que sobrou da sessão anterior não vale para esta** (`web/src/App.tsx:189`): Aviso de expiração que sobrou da sessão anterior não vale para esta.
- **Junto com a troca de tela, para a aba Palpitar aberta não regravar antes de desmontar** (`web/src/App.tsx:222`): Junto com a troca de tela, para a aba Palpitar aberta não regravar antes de desmontar.
- **Só `set`: o que vai no `config` tem precedência sobre `set` e prenderia os // eventos seguintes na p** (`web/src/analytics/ga.ts:134`): Só `set`: o que vai no `config` tem precedência sobre `set` e prenderia os // eventos seguintes na página do primeiro carregamento.
- **Origem do cadastro, enviada à API no clique de "Entrar com Google"** (`web/src/analytics/signupOrigin.ts:1`): Origem do cadastro, enviada à API no clique de "Entrar com Google". A API valida o * valor e só o registra se a conta for nova (docs/observability.md, "Origem do * cadastro"). Só a categoria sai do navegador: o referrer nunca é enviado.
- **Sem especificidade, para quem usa poder esconder a inicial em telas largas** (`web/src/components/Avatar/Avatar.module.css:27`): Sem especificidade, para quem usa poder esconder a inicial em telas largas.
- **Guarda a URL que falhou para voltar à inicial sem esconder uma foto nova** (`web/src/components/Avatar/Avatar.tsx:21`): Guarda a URL que falhou para voltar à inicial sem esconder uma foto nova.
- **As chamadas de apiFetch se acumulam entre os testes** (`web/src/components/CreateGroupModal/hooks/useCreateGroupForm.test.ts:137`): As chamadas de apiFetch se acumulam entre os testes; o POST daqui não pode // aparecer no teste de validação mais abaixo.
- **Só sai do erro numa navegação feita depois dele** (`web/src/components/ErrorBoundary/ErrorBoundary.tsx:27`): Só sai do erro numa navegação feita depois dele. No render que acabou de // quebrar, `prevState.failed` ainda é falso.
- **Tela de uma página que quebrou no render** (`web/src/components/ErrorBoundary/ErrorFallbacks.tsx:8`): Tela de uma página que quebrou no render. Como o cabeçalho também caiu, a tela * oferece o caminho de volta. O clique em "Voltar para o início" também tira o * erro, porque na própria `/` o caminho não muda.
- **Card preenche a altura da célula do grid para que nomes de 1 vs 2 linhas não desalinhem o bloco de b** (`web/src/components/GroupCard/GroupCard.module.css:5`): Card preenche a altura da célula do grid para que nomes de 1 vs 2 linhas não desalinhem o bloco de baixo entre cards vizinhos.
- **Bloco inferior (stats ou pódio) cola no rodapé, independente da altura do título** (`web/src/components/GroupCard/GroupCard.module.css:27`): Bloco inferior (stats ou pódio) cola no rodapé, independente da altura do título. Mantém a base alinhada entre cards da mesma linha.
- **Título em cima, badges sempre numa linha própria logo abaixo** (`web/src/components/GroupCard/GroupCard.module.css:37`): Título em cima, badges sempre numa linha própria logo abaixo. Com as badges ao lado do título, nomes curtos e longos davam cards de estrutura diferente na mesma linha do grid. Empilhadas, ficam na mesma posição em todo card.
- **O nome do campeonato aparece inteiro** (`web/src/components/GroupCard/GroupCard.module.css:71`): O nome do campeonato aparece inteiro. Se não couber na largura do card, quebra entre palavras.
- **─── Finished (encerrado) ────────────────────────────────────────────────── Campeonato acabou → o ca** (`web/src/components/GroupCard/GroupCard.module.css:161`): ─── Finished (encerrado) ────────────────────────────────────────────────── Campeonato acabou → o card vira arquivo: quieto e dessaturado. O único estouro é a coroa do campeão em lime. Nenhuma cor nova entra na marca.
- **Coroa: a única cor de marca no card encerrado** (`web/src/components/GroupCard/GroupCard.module.css:227`): Coroa: a única cor de marca no card encerrado.
- **O relógio local fecha o jogo no horário de início, mesmo que a resposta da API // seja de antes do travamento** (`web/src/components/GroupPicksTab/GroupPicksTab.tsx:236`): O relógio local fecha o jogo no horário de início, mesmo que a resposta da API // seja de antes do travamento. A prova do servidor fecha o jogo com o relógio atrasado.
- **Ausente na API antiga** (`web/src/components/GroupPicksTab/useGroupPicksTab.ts:39`): Ausente na API antiga. Sem o campo, a aba não afirma quem palpitou.
- **Using fireEvent instead of userEvent when using fake timers to avoid hanging** (`web/src/components/InfoHint/InfoHint.test.tsx:53`): Using fireEvent instead of userEvent when using fake timers to avoid hanging
- **Open** (`web/src/components/InfoHint/InfoHint.test.tsx:70`): Open
- **Close** (`web/src/components/InfoHint/InfoHint.test.tsx:74`): Close
- **Open again** (`web/src/components/InfoHint/InfoHint.test.tsx:78`): Open again
- **Veio pelo link quando o código enviado é o mesmo que chegou na URL** (`web/src/components/JoinGroupModal/JoinGroupModal.tsx:63`): Veio pelo link quando o código enviado é o mesmo que chegou na URL; // se o usuário apagou e digitou outro, conta como código.
- **Flex para a seta centralizar mesmo quando passa da largura do conteúdo da célula** (`web/src/components/LeaderboardTab/LeaderboardTab.module.css:85`): Flex para a seta centralizar mesmo quando passa da largura do conteúdo da célula.
- **Dois seletores de classe** (`web/src/components/LeaderboardTab/LeaderboardTab.module.css:242`): Dois seletores de classe: o selo vem de outro módulo CSS e não pode depender da ordem.
- **{/* Nome completo para leitor de tela, já que a forma curta seria lida como "Pts"** (`web/src/components/LeaderboardTab/LeaderboardTab.tsx:200`): Nome completo para leitor de tela, já que a forma curta seria lida como "Pts". */}
- **0.92 mantém o texto terciário acima de 4.5:1 sobre o card esmaecido** (`web/src/components/MatchCard/MatchCard.module.css:13`): 0.92 mantém o texto terciário acima de 4.5:1 sobre o card esmaecido.
- **"sáb, 14/11 · 18:30" cabe numa linha em 390 px e não deve quebrar** (`web/src/components/MatchCard/MatchCard.module.css:25`): "sáb, 14/11 · 18:30" cabe numa linha em 390 px e não deve quebrar.
- **Ida e agregado da volta** (`web/src/components/MatchCard/MatchCard.module.css:176`): Ida e agregado da volta. Os nomes longos quebram linha em 390 px.
- **The control row keeps one shared height across states (locked line, score * steppers, 1X2 buttons) s** (`web/src/components/MatchCard/MatchCard.module.css:191`): The control row keeps one shared height across states (locked line, score * steppers, 1X2 buttons) so a locked card and an open card line up in the grid * instead of differing by the stepper's extra height.
- **Dentro do stepper o contorno fica recuado para não ser coberto pelos botões** (`web/src/components/MatchCard/MatchCard.module.css:352`): Dentro do stepper o contorno fica recuado para não ser coberto pelos botões.
- **Durante o envio o botão segue focável e ignora o clique** (`web/src/components/MatchCard/MatchCard.module.css:391`): Durante o envio o botão segue focável e ignora o clique.
- **No box of its own — the three buttons stay flex children of .outcomeRow** (`web/src/components/MatchCard/MatchCard.module.css:421`): No box of its own — the three buttons stay flex children of .outcomeRow.
- **Em tela de toque, os −/+ e os botões de pênalti ganham a área mínima de 44×44 px** (`web/src/components/MatchCard/MatchCard.module.css:565`): Em tela de toque, os −/+ e os botões de pênalti ganham a área mínima de 44×44 px. Com mouse, o stepper mantém 28 px de largura.
- **No celular, os dois steppers ficam centrados na primeira linha** (`web/src/components/MatchCard/MatchCard.module.css:579`): No celular, os dois steppers ficam centrados na primeira linha. Salvar ou * Atualizar desce para uma linha própria, de largura cheia e 44 px de altura, e * a escolha de pênaltis também. Vale até 420 px e, em tela de toque, até 600 px. * Num iPhone de 430 px os −/+ de 44 px ocupam a linha e o botão não cabe ao lado.
- **Escolha de pênalti na mesma linha dos controles, para o empate não aumentar a // altura do card** (`web/src/components/MatchCard/MatchCard.tsx:91`): Escolha de pênalti na mesma linha dos controles, para o empate não aumentar a // altura do card. Depois da escolha os botões viram um chip, e o toque reabre.
- **O leitor de tela ouve o jogo e o estado juntos ao entrar no card** (`web/src/components/MatchCard/MatchCard.tsx:105`): O leitor de tela ouve o jogo e o estado juntos ao entrar no card. "contra" no // lugar de "×", que seria lido como "vezes".
- **O "salvo" de um envio anterior não apaga o de um envio novo** (`web/src/components/MatchCard/useMatchCard.ts:122`): O "salvo" de um envio anterior não apaga o de um envio novo.
- **Envio em andamento. Fica nulo quando o card sai da tela** (`web/src/components/MatchCard/useMatchCard.ts:124`): Envio em andamento. Fica nulo quando o card sai da tela. O PUT segue até o // servidor e a resposta dele é ignorada, porque o pai pode já ter uma edição // mais nova deste jogo.
- **Sem a escolha na tela, o salvamento manda pênalti nulo** (`web/src/components/MatchCard/useMatchCard.ts:227`): Sem a escolha na tela, o salvamento manda pênalti nulo. Um vencedor escolhido // antes de o empate se desfazer não conta como mudança.
- **A opção já salva não reenvia** (`web/src/components/MatchCard/useMatchCard.ts:297`): A opção já salva não reenvia. Depois de uma falha, tocar nela de novo é a nova tentativa.
- **userEvent trava com timers falsos** (`web/src/components/PenaltyBadge/PenaltyBadge.test.tsx:49`): userEvent trava com timers falsos; este teste não depende do fechamento automático.
- **We use fireEvent to simulate touch/click without hover side effects** (`web/src/components/PenaltyBadge/PenaltyBadge.test.tsx:91`): We use fireEvent to simulate touch/click without hover side effects
- **Reserva a altura da barra fixa "Salvar todos", cerca de 62 px, só quando ela aparece** (`web/src/components/PredictionsTab/PredictionsTab.module.css:7`): Reserva a altura da barra fixa "Salvar todos", cerca de 62 px, só quando ela aparece. Sem isso, o último card fica atrás dela.
- **StrictMode como no app** (`web/src/components/PredictionsTab/PredictionsTab.replicate.test.tsx:89`): StrictMode como no app: a montagem dupla não pode contar como saída do contexto.
- **A confirmação da replicação e o aviso do "Salvar todos" podem ocupar três linhas na barra** (`web/src/components/PredictionsTab/PredictionsTab.tsx:177`): A confirmação da replicação e o aviso do "Salvar todos" podem ocupar três linhas na barra.
- **Desktop / falha do menu** (`web/src/components/PredictionsTab/RoundShareActions.tsx:113`): Desktop / falha do menu: a imagem baixou; o link vai no clipboard (e já // está no rodapé do PNG).
- **Antes de os jogos chegarem, tudo pareceria desconhecido e o storage seria apagado** (`web/src/components/PredictionsTab/usePredictionDrafts.ts:50`): Antes de os jogos chegarem, tudo pareceria desconhecido e o storage seria apagado.
- **A confirmação de antes não vale para o que for salvo com a opção nova** (`web/src/components/PredictionsTab/usePredictionsReplicate.ts:88`): A confirmação de antes não vale para o que for salvo com a opção nova.
- **O seletor de pendências só preenche o que falta, inclusive na primeira // importação** (`web/src/components/PredictionsTab/usePredictionsTab.ts:351`): O seletor de pendências só preenche o que falta, inclusive na primeira // importação. O seletor completo, aberto pelo link, sobrescreve.
- **`<option>` só renderiza texto** (`web/src/components/RoundHeader/RoundHeader.tsx:50`): `<option>` só renderiza texto — nada de badge aqui, o marcador vai no rótulo.
- **Ação principal da tela** (`web/src/components/ShareButtons/ShareButtons.module.css:42`): Ação principal da tela. Quebra linha para o rótulo caber em telas estreitas.
- **Cancelar o menu (AbortError) é no-op** (`web/src/components/ShareButtons/ShareButtons.tsx:149`): Cancelar o menu (AbortError) é no-op. Qualquer outra falha (permissão, // contexto não-seguro...) cai para copiar o link, senão o usuário fica sem nada.
- **Não há como saber se a mensagem foi enviada** (`web/src/components/ShareButtons/ShareButtons.tsx:162`): Não há como saber se a mensagem foi enviada; abrir o app com o texto // pronto é o mais perto de "compartilhou" que o navegador deixa medir.
- **FORM_SIZE badges (4 × 18px) + gaps (3 × 4px) + padding do td** (`web/src/components/StandingsTab/StandingsTab.module.css:178`): FORM_SIZE badges (4 × 18px) + gaps (3 × 4px) + padding do td: sem width explícita, table-layout: fixed espreme a coluna e os badges vazam.
- **Jogo mais recente ganha um anel discreto** (`web/src/components/StandingsTab/StandingsTab.module.css:218`): Jogo mais recente ganha um anel discreto — recência sem depender de posição
- **Return a never-resolving promise to keep it in the loading state, // avoiding the act() warning that** (`web/src/components/StandingsTab/StandingsTab.test.tsx:365`): Return a never-resolving promise to keep it in the loading state, // avoiding the act() warning that occurs if it resolves after the test finishes.
- **Escape na fase de captura** (`web/src/components/Tooltip/useTooltip.ts:17`): Escape na fase de captura: fecha só o tooltip e não chega ao modal que o // contém. O Escape seguinte, já com o tooltip fechado, fecha o modal.
- **A ordem vem da API; a lista não deve ser reordenada no front** (`web/src/hooks/useMatchRounds.ts:26`): A ordem vem da API; a lista não deve ser reordenada no front.
- **Início além do limite do `setTimeout` espera o intervalo trazer `now` para perto** (`web/src/hooks/useNow.ts:31`): Início além do limite do `setTimeout` espera o intervalo trazer `now` para perto.
- **A vaga de "você" é reservada, para ele nunca cair dentro do "e mais N"** (`web/src/lib/groupReminder.ts:69`): A vaga de "você" é reservada, para ele nunca cair dentro do "e mais N".
- **Equivalente a `decides_on_penalties` no card** (`web/src/lib/mataMataVectors.ts:17`): Equivalente a `decides_on_penalties` no card. * Na volta o produto usa `true`; na ida o card nunca pede pênalti (mesmo com * `true`, coberto por `ida-com-empate-ainda-nao-pede-penalti`).
- **O Intl abrevia com ponto ("sáb.")** (`web/src/lib/matchTime.ts:24`): O Intl abrevia com ponto ("sáb."). O card usa a forma curta sem ponto.
- **Largura proporcional realista para sans-serif bold** (`web/src/lib/milestoneShareCard.test.ts:18`): Largura proporcional realista para sans-serif bold: ~0.62 × tamanho por * caractere latino típico. O link público de 32 hex mede ~1.020 px em 36 px, * acima dos 920 px úteis do rodapé.
- **Offline, a query roda e falha em vez de pausar, e o erro de rede aparece na tela** (`web/src/lib/queryClient.ts:8`): Offline, a query roda e falha em vez de pausar, e o erro de rede aparece na tela.
- **Resultado atrasado no cliente** (`web/src/lib/resultOverdue.ts:1`): Resultado atrasado no cliente: mesma regra do painel e do alerta * (`api/src/matches/resultOverdue.ts`). Limiar padrão de 3 h; a UI usa a * constante local porque o bundle não lê o env do Worker. Se o operador * alterar `RESULT_OVERDUE_HOURS` na API, o painel e o e-mail acompanham; o * badge do participante continua no padrão documentado até o front receber …
- **Quem vê a tela vem primeiro, para nunca cair no "e mais N"** (`web/src/lib/roundSummary.ts:159`): Quem vê a tela vem primeiro, para nunca cair no "e mais N".
- **Revoga no próximo tick** (`web/src/lib/shareImage.ts:13`): Revoga no próximo tick. Revogar antes de o navegador iniciar o download // interrompe o salvamento em alguns browsers.
- **Liga (CBF, aproximado)** (`web/src/lib/standings.ts:208`): Liga (CBF, aproximado): pontos, VITÓRIAS, saldo, gols pró. Critérios // seguintes do regulamento (confronto direto, cartões) não se aplicam — // cartões não são sincronizados; empate residual cai em ordem alfabética. // Copa (FIFA): pontos, saldo, gols pró.
- **Lista de campeonatos** (`web/src/pages/AdminMetricsPage/AdminMetricsPage.module.css:179`): Lista de campeonatos: 8 colunas não cabem no celular — rola na horizontal.
- **Sampling do AE: média > 1 significa amostragem** (`web/src/pages/AdminMetricsPage/AdminMetricsPage.tsx:106`): Sampling do AE: média > 1 significa amostragem — números viram estimativa.
- **{/* title mantém o event_type cru** (`web/src/pages/AdminMetricsPage/AdminMetricsPage.tsx:223`): title mantém o event_type cru — é a chave do esquema posicional em docs/observability.md */}
- **Provedores: falha ou API antiga não derruba a página (cai em "indisponível")** (`web/src/pages/AdminMetricsPage/AdminMetricsPage.tsx:524`): Provedores: falha ou API antiga não derruba a página (cai em "indisponível").
- **Negócio e arquivo são secundários** (`web/src/pages/AdminMetricsPage/AdminMetricsPage.tsx:539`): Negócio e arquivo são secundários — falha neles não derruba a página inteira.
- **Análise do arquivo frio, sob demanda (um mês por vez)** (`web/src/pages/AdminMetricsPage/AdminMetricsPage.tsx:572`): Análise do arquivo frio, sob demanda (um mês por vez) — independente do período. // Só o último mês pedido grava resultado e encerra o "Lendo arquivos…".
- **Desmontou: nenhum pedido em voo é o último** (`web/src/pages/AdminMetricsPage/AdminMetricsPage.tsx:581`): Desmontou: nenhum pedido em voo é o último.
- **Sob sampling o peso é fracionário** (`web/src/pages/AdminMetricsPage/CompetitionActivitySection.tsx:112`): Sob sampling o peso é fracionário: dois decimais bastam pro tooltip.
- **Eventos que o sync não importou** (`web/src/pages/AdminMetricsPage/ProviderOpsSection.tsx:510`): Eventos que o sync não importou. Some quando a API ainda não envia o campo, * para não afirmar zero sem dado.
- **Jogos pendentes que a descoberta não viu no calendário completo da * football-data** (`web/src/pages/AdminMetricsPage/ProviderOpsSection.tsx:535`): Jogos pendentes que a descoberta não viu no calendário completo da * football-data. Some quando a API ainda não envia o campo.
- **O id chega vazio quando a sanitização o descarta** (`web/src/pages/AdminMetricsPage/ProviderOpsSection.tsx:588`): O id chega vazio quando a sanitização o descarta; o índice evita a colisão.
- **Competições com jogo encerrado que passou mais de um ciclo do poller sem * pontuação** (`web/src/pages/AdminMetricsPage/ProviderOpsSection.tsx:604`): Competições com jogo encerrado que passou mais de um ciclo do poller sem * pontuação. Some quando a API ainda não envia o campo.
- **A resposta pode vir de uma API antiga ou truncada** (`web/src/pages/AdminMetricsPage/ProviderOpsSection.tsx:695`): A resposta pode vir de uma API antiga ou truncada: só renderiza o que tem forma.
- **Uso das cotas diárias do plano Free (ADR-022)** (`web/src/pages/AdminMetricsPage/QuotaUsageSection.tsx:4`): Uso das cotas diárias do plano Free (ADR-022). Consome GET /metrics/quota: a * última medição do cron das 00:05 UTC, que soma o uso do dia UTC anterior na conta * inteira. Acima de 50% de uma cota por 3 dias seguidos é o gatilho de migração ao * Workers Paid.
- **Acima disso os tipos menos frequentes agrupam em "outros" (paleta acaba)** (`web/src/pages/AdminMetricsPage/overview.ts:8`): Acima disso os tipos menos frequentes agrupam em "outros" (paleta acaba).
- **Saúde de resultados (D1)** (`web/src/pages/AdminMetricsPage/types.ts:75`): Saúde de resultados (D1). Ausentes numa API anterior a esse recorte — // a página mostra "—" / aviso em vez de tratar a falta como zero.
- **`events` = contagem real do dia (customMetadata do export)** (`web/src/pages/AdminMetricsPage/types.ts:82`): `events` = contagem real do dia (customMetadata do export); null em // arquivo antigo que o backfill de metadata ainda não alcançou.
- **Análise sob demanda do arquivo frio** (`web/src/pages/AdminMetricsPage/types.ts:92`): Análise sob demanda do arquivo frio: agrega o CORPO dos NDJSON de um período // (GET /metrics/archive/query). Único jeito de dissecar dados além da janela do AE.
- **Ausentes em API anterior ao teto de leitura** (`web/src/pages/AdminMetricsPage/types.ts:101`): Ausentes em API anterior ao teto de leitura. `truncated`: o teto de bytes // parou a leitura e só os dias de `daysRead` entraram.
- **A preferência vale só para essa abertura** (`web/src/pages/DashboardPage/DashboardPage.tsx:260`): A preferência vale só para essa abertura. Fechar o modal a descarta.
- **Tira só o `competicao` da entrada atual do histórico, para recarregar não // reabrir o modal** (`web/src/pages/DashboardPage/DashboardPage.tsx:268`): Tira só o `competicao` da entrada atual do histórico, para recarregar não // reabrir o modal. A volta até `/entrar` fica a cargo do redirect do App.
- **Faixa "Próximo prazo" no topo do painel** (`web/src/pages/DashboardPage/NextDeadlineBanner.module.css:1`): Faixa "Próximo prazo" no topo do painel. Com pendência ela é o primeiro elemento com a cor da marca na tela, porque é a ação da visita. Sem pendência vira uma linha discreta.
- **Só a carga mais recente aplica a resposta** (`web/src/pages/DashboardPage/hooks/useDashboardGroups.ts:24`): Só a carga mais recente aplica a resposta. Uma anterior que chega depois é descartada.
- **Busca a lista de novo sem a tela de carregamento, para os números que mudam com * o relógio** (`web/src/pages/DashboardPage/hooks/useDashboardGroups.ts:59`): Busca a lista de novo sem a tela de carregamento, para os números que mudam com * o relógio. A lista atual fica na tela até a nova chegar. Devolve a lista nova, * ou null quando a busca falha ou uma carga pedida depois descarta a resposta. * Na falha, a lista atual continua.
- **Keep tabs under the primary header (z-index** (`web/src/pages/GroupDetailPage/GroupDetailPage.module.css:413`): Keep tabs under the primary header (z-index: 10) and above page content.
- **Tira a confirmação do histórico, para o recarregamento não repetir o aviso** (`web/src/pages/GroupDetailPage/GroupDetailPage.tsx:137`): Tira a confirmação do histórico, para o recarregamento não repetir o aviso.
- **O texto do título e o botão ficam no mesmo h2, e o CSS mostra um dos dois** (`web/src/pages/GroupDetailPage/GroupInviteSection.tsx:60`): O texto do título e o botão ficam no mesmo h2, e o CSS mostra um dos dois. // Acima de 600 px aparece o título e o conteúdo fica aberto. No celular // aparece o botão, e o conteúdo só abre com `data-expanded`. O h2 continua na // navegação por títulos nos dois casos. Sem matchMedia, o primeiro render já // sai no estado certo.
- **O servidor deriva o valor dos jogos** (`web/src/pages/GroupDetailPage/types.ts:14`): O servidor deriva o valor dos jogos. Liga vira 'finished' quando não tem * jogo pendente. Copa precisa também da final encerrada.
- **text-secondary em vez de text-muted** (`web/src/pages/LandingPage/LandingPage.module.css:505`): text-secondary em vez de text-muted: segue o texto principal do rodapé.
- **Decorative browser-window chrome wrapped around a screenshot, so the preview * reads as a real produ** (`web/src/pages/LandingPage/LandingPage.tsx:465`): Decorative browser-window chrome wrapped around a screenshot, so the preview * reads as a real product shot rather than a bare image.
- **Aviso que explica por que a pessoa chegou ao login** (`web/src/pages/LoginPage/LoginPage.tsx:15`): Aviso que explica por que a pessoa chegou ao login. Consome as duas marcas, * para nenhuma sobrar para a próxima visita.
- **Lido uma vez e apagado, para um refresh de /entrar não repetir o aviso** (`web/src/pages/LoginPage/LoginPage.tsx:38`): Lido uma vez e apagado, para um refresh de /entrar não repetir o aviso.
- **Descreve o cron de api/src/notifications/roundReminder.ts** (`web/src/pages/SettingsPage/SettingsPage.tsx:15`): Descreve o cron de api/src/notifications/roundReminder.ts. Mudou a regra, muda o texto.
- **Tertiary text, labels and placeholders** (`web/src/styles/variables.css:52`): Tertiary text, labels and placeholders. 4.5:1 or more on every surface
- **Opt-in: carrega o script público** (`web/tests/e2e/cookie-consent-layout-real-gtag.spec.ts:3`): Opt-in: carrega o script público; toda requisição de coleta é abortada.
- **Bloqueia outros endpoints de dados** (`web/tests/e2e/cookie-consent-layout-real-gtag.spec.ts:26`): Bloqueia outros endpoints de dados; só o script público pode sair.
- **A espera pela resposta começa antes do clique** (`web/tests/e2e/group-admin.spec.ts:180`): A espera pela resposta começa antes do clique. A resposta mockada pode chegar // antes de o clique terminar, e uma espera registrada depois dela não termina.
- **Mede cada linha do texto com Range, não a caixa do h3** (`web/tests/e2e/group-card-layout.spec.ts:53`): Mede cada linha do texto com Range, não a caixa do h3: o título pode encolher * (min-width: 0) e deixar o texto vazar para fora da própria caixa. Os limites são * os da caixa de conteúdo do link, sem o padding.
- **5. Checar a mensagem de sucesso e o request** (`web/tests/e2e/settings.spec.ts:54`): 5. Checar a mensagem de sucesso e o request. A mensagem só aparece depois // da resposta do PATCH; conferir a flag antes dela corre contra o clique.
- **O Miniflare 5 (alpha, trazido pelo wrangler) mudou o formato das opções e // expõe o conversor do fo** (`web/tests/functions/convite.test.ts:277`): O Miniflare 5 (alpha, trazido pelo wrangler) mudou o formato das opções e // expõe o conversor do formato antigo; o 4 aceita o formato antigo direto.

### Consequences

- Racional da UI e do build fica na ADR; o ratchet impede comentário novo sem baixar o baseline.
- Detalhe fino de teste que não é decisão ficou em `leftInPlace` para a próxima passagem da skill `delete-comment`.
