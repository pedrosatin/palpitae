# Graph Report - palpitae  (2026-07-05)

## Corpus Check
- 165 files · ~95,841 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1071 nodes · 2162 edges · 86 communities (82 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9d37a062`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Bracket UI Components|Bracket UI Components]]
- [[_COMMUNITY_API Routers & Auth Middleware|API Routers & Auth Middleware]]
- [[_COMMUNITY_Auth Encoding & Google OAuth|Auth Encoding & Google OAuth]]
- [[_COMMUNITY_Architecture Decision Records|Architecture Decision Records]]
- [[_COMMUNITY_Create Group Modal (legacy)|Create Group Modal (legacy)]]
- [[_COMMUNITY_Dashboard & Group Detail Pages|Dashboard & Group Detail Pages]]
- [[_COMMUNITY_Predictions Tab (legacy)|Predictions Tab (legacy)]]
- [[_COMMUNITY_Bracket API Router|Bracket API Router]]
- [[_COMMUNITY_App Entry & Login|App Entry & Login]]
- [[_COMMUNITY_Match Card Component|Match Card Component]]
- [[_COMMUNITY_Predictions Tab Component|Predictions Tab Component]]
- [[_COMMUNITY_Group Card (legacy)|Group Card (legacy)]]
- [[_COMMUNITY_Group Card Component|Group Card Component]]
- [[_COMMUNITY_Fixture Sync (API Football)|Fixture Sync (API Football)]]
- [[_COMMUNITY_Create Group Modal|Create Group Modal]]
- [[_COMMUNITY_Button & Header (legacy)|Button & Header (legacy)]]
- [[_COMMUNITY_Join Group Modal|Join Group Modal]]
- [[_COMMUNITY_Header Tests (legacy)|Header Tests (legacy)]]
- [[_COMMUNITY_Group Detail Page Tests (legacy)|Group Detail Page Tests (legacy)]]
- [[_COMMUNITY_Group Detail Page (legacy)|Group Detail Page (legacy)]]
- [[_COMMUNITY_Modal (legacy)|Modal (legacy)]]
- [[_COMMUNITY_Card (legacy)|Card (legacy)]]
- [[_COMMUNITY_Card Component|Card Component]]
- [[_COMMUNITY_Modal Component|Modal Component]]
- [[_COMMUNITY_Team Badge Component|Team Badge Component]]
- [[_COMMUNITY_Dashboard Page Tests (legacy)|Dashboard Page Tests (legacy)]]
- [[_COMMUNITY_Button Component|Button Component]]
- [[_COMMUNITY_Google Login Button|Google Login Button]]
- [[_COMMUNITY_Brand SVG Assets|Brand SVG Assets]]
- [[_COMMUNITY_Pages Function Proxy|Pages Function Proxy]]
- [[_COMMUNITY_Web App Entry|Web App Entry]]
- [[_COMMUNITY_Icon SVG Assets|Icon SVG Assets]]
- [[_COMMUNITY_API Vitest Config|API Vitest Config]]
- [[_COMMUNITY_Web Vite Config|Web Vite Config]]
- [[_COMMUNITY_Vite Env Types|Vite Env Types]]
- [[_COMMUNITY_Web Test Setup|Web Test Setup]]
- [[_COMMUNITY_Dashboard Page Barrel|Dashboard Page Barrel]]
- [[_COMMUNITY_Group Detail Page Barrel|Group Detail Page Barrel]]
- [[_COMMUNITY_Login Page Barrel|Login Page Barrel]]
- [[_COMMUNITY_Bracket Tab Barrel|Bracket Tab Barrel]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 62|Community 62]]

## God Nodes (most connected - your core abstractions)
1. `trackEvent()` - 34 edges
2. `AppContext` - 31 edges
3. `config` - 31 edges
4. `signJwt()` - 28 edges
5. `🧠 Palpitae — Product Vision` - 23 edges
6. `🤖 AGENTS.md — Palpitae` - 19 edges
7. `syncFixtures()` - 17 edges
8. `sendRoundReminders()` - 17 edges
9. `scoreUnprocessedMatches()` - 16 edges
10. `useDocumentTitle()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `generateState()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/auth/google.ts → /home/satin/Work/palpitae/api/src/auth/encoding.ts
- `generateNonce()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/auth/google.ts → /home/satin/Work/palpitae/api/src/auth/encoding.ts
- `generatePkce()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/auth/google.ts → /home/satin/Work/palpitae/api/src/auth/encoding.ts
- `verifyGoogleIdToken()` --calls--> `base64UrlDecode()`  [EXTRACTED]
  api/src/auth/google.ts → /home/satin/Work/palpitae/api/src/auth/encoding.ts
- `signJwt()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/auth/jwt.ts → /home/satin/Work/palpitae/api/src/auth/encoding.ts

## Communities (86 total, 4 thin omitted)

### Community 0 - "Bracket UI Components"
Cohesion: 0.06
Nodes (48): fakeEnv(), requestWithCookie(), competitions, result, router, ActiveCompetition, discoverFixtures(), ActiveRound (+40 more)

### Community 1 - "API Routers & Auth Middleware"
Cohesion: 0.07
Nodes (51): HMAC_SHA256, importHmacKey(), base64UrlDecode(), base64UrlEncode(), buf, decoded, encoded, original (+43 more)

### Community 2 - "Auth Encoding & Google OAuth"
Cohesion: 0.1
Nodes (33): KNOCKOUT_LABELS, roundLabel(), EmailError, EmailMessage, sendEmail(), body, buildEmailHtml(), buildEmailText() (+25 more)

### Community 3 - "Architecture Decision Records"
Cohesion: 0.11
Nodes (33): matchGoesToPenalties(), parsePenaltyPhases(), cacheKey, competitionId, dbStartedAt, matchesCacheControl(), matchesOut, maybeSyncResults() (+25 more)

### Community 4 - "Create Group Modal (legacy)"
Cohesion: 0.1
Nodes (33): FEATURE_KEYS, FeatureFlags, FeatureKey, getFeatureFlags(), hasFeatureAccess(), flags, flags1, flags2 (+25 more)

### Community 5 - "Dashboard & Group Detail Pages"
Cohesion: 0.1
Nodes (33): ActiveRow, ae, buildFakeAe(), buildFakeDb(), db, [earliestOver, stillRelevant], errors, matchdays (+25 more)

### Community 6 - "Predictions Tab (legacy)"
Cohesion: 0.05
Nodes (36): 🔐 Authentication, Backend (API), Competition, 📏 Constraints, 🧱 Core Product Concept, 🧠 Design Principles, ⚽ Domain Model, Excluded (future): (+28 more)

### Community 7 - "Bracket API Router"
Cohesion: 0.14
Nodes (30): buildAuthUrl(), exchangeCode(), generateNonce(), generatePkce(), generateState(), GoogleIdTokenClaims, GoogleUserInfo, JwksKey (+22 more)

### Community 8 - "App Entry & Login"
Cohesion: 0.12
Nodes (31): byMatch, eligible, groupConfig, groupId, importStatements, info, invalidPenalty, locked (+23 more)

### Community 9 - "Match Card Component"
Cohesion: 0.07
Nodes (19): AdminMetricsPage(), ArchiveResponse, buildApiCallsSeries(), buildStackedSeries(), CRON_INFO, lastDays(), OverviewResponse, PERIODS (+11 more)

### Community 10 - "Predictions Tab Component"
Cohesion: 0.19
Nodes (20): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, awayInput, body, chip (+12 more)

### Community 11 - "Group Card (legacy)"
Cohesion: 0.14
Nodes (14): GroupDetail, GroupDetailPage(), GroupDetailPageProps, parseTab(), Tab, TAB_LABELS, TABS, User (+6 more)

### Community 12 - "Group Card Component"
Cohesion: 0.12
Nodes (21): Competition, CreatedGroup, CreateGroupModal(), CreateGroupModalProps, PRESET_LABELS, PRESET_VALUES, SCORING_HELP_TEXT, ScoringPreset (+13 more)

### Community 13 - "Fixture Sync (API Football)"
Cohesion: 0.19
Nodes (14): DashboardPage(), DashboardPageProps, dialog, fetchSpy, mockResponse(), mockTrackEvent, user, User (+6 more)

### Community 14 - "Create Group Modal"
Cohesion: 0.18
Nodes (15): makeMatch(), GroupPicksResponse, li, matches, { matches, picks }, mockFetch(), mockTrackEvent, twoRounds() (+7 more)

### Community 15 - "Button & Header (legacy)"
Cohesion: 0.2
Nodes (9): Consent, getStoredConsent(), initGa(), setConsent(), Window, CookieConsent(), mockGetStoredConsent, mockSetConsent (+1 more)

### Community 16 - "Join Group Modal"
Cohesion: 0.1
Nodes (18): 🤖 AGENTS.md — Palpitae, 📊 Analytics — GA Events (obrigatório), ⚠️ Anti-Patterns (Avoid), 🏗️ Architecture Guidelines, 🧩 Code Guidelines, 🗄️ Database Rules, ⚽ Domain Rules (Critical), 🧠 General Principles (+10 more)

### Community 17 - "Header Tests (legacy)"
Cohesion: 0.21
Nodes (17): app, body, cacheHeaderFor(), counter, createMatchesDbMock(), env, fakeEnv(), first (+9 more)

### Community 18 - "Group Detail Page Tests (legacy)"
Cohesion: 0.11
Nodes (17): code:mermaid (erDiagram), code:sql (PRAGMA foreign_keys = ON;), `competitions`, Database Schema — Palpitae, Entities, Entity Relationship Diagram, `group_members`, `groups` (+9 more)

### Community 19 - "Group Detail Page (legacy)"
Cohesion: 0.11
Nodes (17): ✅ Alta Confiança, Anti-Abuse Strategy (MVP), ⚠️ Corrigido, ✅ In Scope, Key Assumptions to Validate, MVP Scope, Next Steps, Not Doing (and Why) (+9 more)

### Community 20 - "Modal (legacy)"
Cohesion: 0.18
Nodes (10): GroupMember, GroupPicksResponse, GroupPicksTab(), GroupPicksTabProps, MemberPrediction, CacheEntry, fetchCachedJson(), invalidateApiCache() (+2 more)

### Community 21 - "Card (legacy)"
Cohesion: 0.12
Nodes (16): Bônus — alertas, code:sql (SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day), code:sql (SELECT blob1 AS event_type, SUM(_sample_interval) AS count), code:sql (SELECT blob2 AS status,), code:sql (SELECT COUNT(DISTINCT blob4) AS users), Comparação com a Opção B (dashboard nativo), Dashboard de métricas — Opção A: Grafana Cloud, O que o Grafana cobre (e o que não) (+8 more)

### Community 22 - "Card Component"
Cohesion: 0.12
Nodes (14): Analytics Engine — hot path (retenção ~3 meses), Arquitetura, As 3 camadas (não confundir), code:ts (import { hashUserId, logEvent } from '../observability'), Dashboard de métricas, Decisões descartadas — NÃO re-propor, Esquema e convenção de eventos, Esquema posicional por evento (+6 more)

### Community 23 - "Modal Component"
Cohesion: 0.27
Nodes (13): body, BulkMockOptions, capturedSql, createBulkDbMock(), createGroupPicksDbMock(), db, fakeEnv(), GroupMockOptions (+5 more)

### Community 24 - "Team Badge Component"
Cohesion: 0.26
Nodes (11): computeStandings(), emptyStanding(), formatDay(), StandingsTab(), StandingsTabProps, TeamStanding, makeMatch(), matches (+3 more)

### Community 25 - "Dashboard Page Tests (legacy)"
Cohesion: 0.13
Nodes (13): Bônus de pênalti (`points_penalty`), Campos (tabela `groups`), Configuração de pontuação e visibilidade por grupo, `exact_hits` no leaderboard, Gate por `(competição, fase)` — fonte de verdade `competitions.penalty_phases`, Invariantes (validadas na API **e** no front), Modo 1X2 (`points_exact = 0`), Observabilidade (+5 more)

### Community 26 - "Button Component"
Cohesion: 0.32
Nodes (8): applyDefaultRound(), isGroupStageRound(), KNOCKOUT_LABELS, roundLabel(), setRoundIndex, PredictionMap, PredictionsTab(), PredictionsTabProps

### Community 27 - "Google Login Button"
Cohesion: 0.23
Nodes (7): trackEvent(), GoogleLoginButton(), GoogleLogo(), mockTrackEvent, Header(), HeaderProps, User

### Community 28 - "Brand SVG Assets"
Cohesion: 0.3
Nodes (10): baseGroup, baseUser, fetchSpy, input, mockGroupFetch(), mockGroupFetchSequence(), mockTrackEvent, renderPage() (+2 more)

### Community 29 - "Pages Function Proxy"
Cohesion: 0.27
Nodes (8): formatDate(), LeaderboardTab(), LeaderboardTabProps, Member, members, mockFetch(), mockTrackEvent, UserPrediction

### Community 30 - "Web App Entry"
Cohesion: 0.17
Nodes (11): A. Ativar e verificar o GA4 em produção *(ação do dono — sem código)*, ⏸️ Adiado por design — só fazer quando o gatilho existir, B. Keyword research *(depende de tráfego acumular no Search Console)*, C. Bing Webmaster Tools *(ação do dono — sem código)*, context-seo.md — SEO, Performance & Analytics, Contexto do projeto (o que importa aqui), D. Link building *(ação do dono — sem código)*, ❌ Decisões descartadas — NÃO re-propor (+3 more)

### Community 31 - "Icon SVG Assets"
Cohesion: 0.29
Nodes (7): BrowserFrame(), FaqItem(), FeatureRow(), LandingPage(), Shot(), mockTrackEvent, renderPage()

### Community 32 - "API Vitest Config"
Cohesion: 0.25
Nodes (5): Member, MembersTab(), MembersTabProps, members, mockTrackEvent

### Community 33 - "Web Vite Config"
Cohesion: 0.18
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 34 - "Vite Env Types"
Cohesion: 0.36
Nodes (8): baseUser, link, mockTrackEvent, onCreateGroup, onJoinGroup, onLogout, renderHeader(), sairBtn

### Community 35 - "Web Test Setup"
Cohesion: 0.2
Nodes (9): API — Setup local, code:bash (cd api), code:bash (# Start local dev server (http://localhost:8787)), code:bash (# Set production secrets (one-time, stored encrypted in Clou), Deploying, First-time setup, Palpitae, Prerequisites (+1 more)

### Community 36 - "Dashboard Page Barrel"
Cohesion: 0.22
Nodes (7): Analytics — eventos de clique (GA4, lado cliente), code:ts (import { trackEvent } from '../../analytics/ga'), Consentimento e LGPD, Convenções de nome, Eventos já mapeados, O que rastrear vs. ignorar, Regra

### Community 37 - "Group Detail Page Barrel"
Cohesion: 0.36
Nodes (7): AdminMetricsPage, App(), AuthStatus, DashboardPage, GroupDetailPage, SettingsPage, User

### Community 38 - "Login Page Barrel"
Cohesion: 0.25
Nodes (4): GroupCardProps, GroupWithStats, baseGroup, onClick

### Community 39 - "Bracket Tab Barrel"
Cohesion: 0.36
Nodes (4): ConfirmModal(), ConfirmModalProps, ConfirmOptions, useConfirm()

### Community 40 - "Community 40"
Cohesion: 0.43
Nodes (6): fetchSpy, mockResponse(), mockTrackEvent, patchCall, renderPage(), user

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (8): ADR-006: Frontend Stack — Vite + React (Static Site), Consequences, Consequences, Context, Decision, Decision, Design Token System, Why not Next.js / Remix?

### Community 42 - "Community 42"
Cohesion: 0.25
Nodes (8): ADR-007: Result Sync Strategy — Cron-Triggered Time-Window Poller, Alternatives Considered, code:block1 (First half:           45 min), code:sql (SELECT DISTINCT c.id AS comp_id, c.external_id, c.season, m.), Consequences, Context, Decision, Implementation

### Community 43 - "Community 43"
Cohesion: 0.48
Nodes (5): body, defaultProps, fetchSpy, joinedGroup, mockTrackEvent

### Community 44 - "Community 44"
Cohesion: 0.29
Nodes (5): ADR-001: Database Platform — Cloudflare D1, Architecture Decision Records, Consequences, Context, Decision

### Community 45 - "Community 45"
Cohesion: 0.47
Nodes (4): env, fetchMatches(), main(), summarizeMatches()

### Community 46 - "Community 46"
Cohesion: 0.33
Nodes (3): CardProps, { container }, div

### Community 48 - "Community 48"
Cohesion: 0.33
Nodes (5): Dashboard Nativo (Admin Metrics) — ideias futuras, Descartado — NÃO re-propor, Ideias pendentes, Linha de referência de quota da API Football, Mapa de calor por horário

### Community 49 - "Community 49"
Cohesion: 0.33
Nodes (6): ADR-009: Round Reminder Notifications — Transactional E-mail via Resend, Alternatives Considered, Consequences, Context, Decision, Implementation

### Community 50 - "Community 50"
Cohesion: 0.33
Nodes (6): ADR-010: Fixture Discovery — Daily Full-Competition Sync Cron, Consequences, Context, Decision, Why a full sync (not "wait for the round to end"), Why not reuse the existing crons

### Community 52 - "Community 52"
Cohesion: 0.6
Nodes (3): BallIcon(), PenaltyBadge(), PenaltyBadgeProps

### Community 53 - "Community 53"
Cohesion: 0.6
Nodes (3): Analytics — eventos de clique (obrigatório), graphify, Observabilidade — eventos server-side (obrigatório)

### Community 54 - "Community 54"
Cohesion: 0.4
Nodes (5): ADR-002: Migration Strategy — Wrangler D1 Migrations, Consequences, Context, Decision, Rules

### Community 55 - "Community 55"
Cohesion: 0.4
Nodes (5): ADR-005: Authentication — Direct Google OAuth 2.0, Consequences, Context, Decision, Security Requirements

### Community 56 - "Community 56"
Cohesion: 0.5
Nodes (3): Overview, System Architecture — Palpitae, Working with Architecture

### Community 57 - "Community 57"
Cohesion: 0.5
Nodes (4): ADR-004: Prediction Locking — Derived at Runtime, Consequences, Context, Decision

### Community 58 - "Community 58"
Cohesion: 0.5
Nodes (4): ADR-008: Caching Strategy for `GET /matches` — Content-Derived TTL + Edge Cache API, Consequences, Context, Decision

### Community 59 - "Community 59"
Cohesion: 0.5
Nodes (4): ADR-003: API Runtime — Cloudflare Workers + Hono, Consequences, Context, Decision

## Knowledge Gaps
- **223 isolated node(s):** `PackageJson`, `[, body]`, `payload`, `[h, , s]`, `tamperedBody` (+218 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppContext` connect `Bracket UI Components` to `API Routers & Auth Middleware`, `Architecture Decision Records`, `Create Group Modal (legacy)`, `Bracket API Router`, `App Entry & Login`, `Header Tests (legacy)`, `Modal Component`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `trackEvent()` connect `Google Login Button` to `API Vitest Config`, `Match Card Component`, `Predictions Tab Component`, `Group Card (legacy)`, `Group Card Component`, `Fixture Sync (API Football)`, `Button & Header (legacy)`, `Modal (legacy)`, `Team Badge Component`, `Button Component`, `Pages Function Proxy`, `Icon SVG Assets`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `scoreUnprocessedMatches()` connect `Architecture Decision Records` to `Bracket UI Components`, `Dashboard & Group Detail Pages`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `PackageJson`, `[, body]`, `payload` to the rest of the system?**
  _223 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bracket UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `API Routers & Auth Middleware` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Auth Encoding & Google OAuth` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._