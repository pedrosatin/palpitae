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

### Consequences

- O `finally` libera as reservas quando a execução termina por retorno ou exceção. Um encerramento forçado do runtime que impeça o `finally`, ou uma falha do próprio D1 na liberação, ainda pode deixar reservas até o fim do dia. A falha de liberação vai para o log.
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

`DELETE /admin/users/:id`, só para o admin, faz tudo numa transação do D1: transfere os grupos, apaga os que ficaram sem membro, apaga as linhas de `payments` da conta (tabela sem uso e sem cascata) e apaga a conta. A cascata leva perfil, participações, palpites, ranking, banimentos, palpites de chave e reservas de lembrete. A sessão deixa de valer na requisição seguinte, porque `verifySession` exige a conta no banco. O admin não exclui a própria conta pela rota.

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
