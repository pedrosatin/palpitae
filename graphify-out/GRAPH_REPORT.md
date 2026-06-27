# Graph Report - palpitae  (2026-06-27)

## Corpus Check
- 146 files · ~85,047 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 852 nodes · 1132 edges · 71 communities (67 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f6c42fac`
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

## God Nodes (most connected - your core abstractions)
1. `🧠 Palpitae — Product Vision` - 23 edges
2. `signJwt()` - 18 edges
3. `🤖 AGENTS.md — Palpitae` - 18 edges
4. `trackEvent()` - 16 edges
5. `AppContext` - 15 edges
6. `config` - 15 edges
7. `sendRoundReminders()` - 12 edges
8. `base64UrlEncode()` - 11 edges
9. `Entities` - 11 edges
10. `Architecture Decision Records` - 10 edges

## Surprising Connections (you probably didn't know these)
- `signJwt()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/auth/jwt.ts → /home/satin/Work/palpitae/api/src/auth/encoding.ts
- `generateState()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/auth/google.ts → /home/satin/Work/palpitae/api/src/auth/encoding.ts
- `generateNonce()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/auth/google.ts → /home/satin/Work/palpitae/api/src/auth/encoding.ts
- `generatePkce()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/auth/google.ts → /home/satin/Work/palpitae/api/src/auth/encoding.ts
- `signUnsubToken()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/notifications/unsubscribeToken.ts → /home/satin/Work/palpitae/api/src/auth/encoding.ts

## Communities (71 total, 4 thin omitted)

### Community 0 - "Bracket UI Components"
Cohesion: 0.06
Nodes (34): requireAuth, app, fakeEnv(), requestWithCookie(), authRouter, fakeEnv(), requestWithCookie(), competitions (+26 more)

### Community 1 - "API Routers & Auth Middleware"
Cohesion: 0.06
Nodes (43): HMAC_SHA256, importHmacKey(), base64UrlDecode(), base64UrlEncode(), buf, decoded, encoded, original (+35 more)

### Community 2 - "Auth Encoding & Google OAuth"
Cohesion: 0.04
Nodes (47): ADR-001: Database Platform — Cloudflare D1, ADR-002: Migration Strategy — Wrangler D1 Migrations, ADR-003: API Runtime — Cloudflare Workers + Hono, ADR-004: Prediction Locking — Derived at Runtime, ADR-005: Authentication — Direct Google OAuth 2.0, ADR-006: Frontend Stack — Vite + React (Static Site), ADR-007: Result Sync Strategy — Cron-Triggered Time-Window Poller, ADR-008: Caching Strategy for `GET /matches` — Content-Derived TTL + Edge Cache API (+39 more)

### Community 3 - "Architecture Decision Records"
Cohesion: 0.07
Nodes (35): EmailError, EmailMessage, sendEmail(), body, buildEmailHtml(), buildEmailText(), crestImg(), escapeHtml() (+27 more)

### Community 4 - "Create Group Modal (legacy)"
Cohesion: 0.05
Nodes (36): 🔐 Authentication, Backend (API), Competition, 📏 Constraints, 🧱 Core Product Concept, 🧠 Design Principles, ⚽ Domain Model, Excluded (future): (+28 more)

### Community 5 - "Dashboard & Group Detail Pages"
Cohesion: 0.08
Nodes (27): signJwt(), [, body], [h, , s], payload, tamperedBody, body, createDbMock(), createGroupsListDbMock() (+19 more)

### Community 6 - "Predictions Tab (legacy)"
Cohesion: 0.07
Nodes (29): FEATURE_KEYS, FeatureFlags, FeatureKey, getFeatureFlags(), hasFeatureAccess(), body, candidate, competition_id (+21 more)

### Community 7 - "Bracket API Router"
Cohesion: 0.06
Nodes (31): byMatch, eligible, groupConfig, groupId, importStatements, info, invalidPenalty, locked (+23 more)

### Community 8 - "App Entry & Login"
Cohesion: 0.07
Nodes (19): ConfirmModalProps, ConfirmOptions, useConfirm(), GroupDetail, GroupDetailPage(), GroupDetailPageProps, parseTab(), Tab (+11 more)

### Community 9 - "Match Card Component"
Cohesion: 0.09
Nodes (18): InfoHintProps, formatDate(), Match, MatchCard(), MatchCardProps, Prediction, awayInput, body (+10 more)

### Community 10 - "Predictions Tab Component"
Cohesion: 0.09
Nodes (16): body, competitions, createdGroup, defaultProps, exact, fetchSpy, infoBtn, mockTrackEvent (+8 more)

### Community 11 - "Group Card (legacy)"
Cohesion: 0.11
Nodes (18): 🤖 AGENTS.md — Palpitae, 📊 Analytics — GA Events (obrigatório), ⚠️ Anti-Patterns (Avoid), 🏗️ Architecture Guidelines, 🧩 Code Guidelines, 🗄️ Database Rules, ⚽ Domain Rules (Critical), 🧠 General Principles (+10 more)

### Community 12 - "Group Card Component"
Cohesion: 0.12
Nodes (13): app, body, cacheHeaderFor(), counter, createMatchesDbMock(), env, fakeEnv(), first (+5 more)

### Community 13 - "Fixture Sync (API Football)"
Cohesion: 0.11
Nodes (17): code:mermaid (erDiagram), code:sql (PRAGMA foreign_keys = ON;), `competitions`, Database Schema — Palpitae, Entities, Entity Relationship Diagram, `group_members`, `groups` (+9 more)

### Community 14 - "Create Group Modal"
Cohesion: 0.11
Nodes (17): ✅ Alta Confiança, Anti-Abuse Strategy (MVP), ⚠️ Corrigido, ✅ In Scope, Key Assumptions to Validate, MVP Scope, Next Steps, Not Doing (and Why) (+9 more)

### Community 15 - "Button & Header (legacy)"
Cohesion: 0.13
Nodes (9): makeMatch(), GroupPicksResponse, matches, { matches, picks }, mockTrackEvent, matches, mockTrackEvent, select (+1 more)

### Community 16 - "Join Group Modal"
Cohesion: 0.17
Nodes (10): GroupMember, GroupPicksResponse, GroupPicksTabProps, MemberPrediction, applyDefaultRound(), isGroupStageRound(), KNOCKOUT_LABELS, roundLabel() (+2 more)

### Community 17 - "Header Tests (legacy)"
Cohesion: 0.14
Nodes (10): ActiveRow, ae, db, [earliestOver, stillRelevant], errors, matchdays, runs, scoreMock (+2 more)

### Community 18 - "Group Detail Page Tests (legacy)"
Cohesion: 0.14
Nodes (12): cacheKey, competitionId, dbStartedAt, matchesOut, nowIso, params, response, round (+4 more)

### Community 19 - "Group Detail Page (legacy)"
Cohesion: 0.21
Nodes (8): Consent, getStoredConsent(), initGa(), setConsent(), Window, mockGetStoredConsent, mockSetConsent, rootEl

### Community 20 - "Modal (legacy)"
Cohesion: 0.14
Nodes (13): Analytics Engine — hot path (retenção ~3 meses), Arquitetura, As 3 camadas (não confundir), code:ts (import { hashUserId, logEvent } from '../observability'), Decisões descartadas — NÃO re-propor, Esquema e convenção de eventos, Esquema posicional por evento, LGPD / privacidade (+5 more)

### Community 21 - "Card (legacy)"
Cohesion: 0.15
Nodes (10): batchSpy, db, eligible, FakeGroupConfig, FakeMatch, FakePrediction, matches, predictions (+2 more)

### Community 22 - "Card Component"
Cohesion: 0.15
Nodes (7): mockTrackEvent, AuthStatus, DashboardPage, GroupDetailPage, SettingsPage, User, config

### Community 23 - "Modal Component"
Cohesion: 0.18
Nodes (7): computeStandings(), StandingsTab(), StandingsTabProps, TeamStanding, matches, mockTrackEvent, standings

### Community 24 - "Team Badge Component"
Cohesion: 0.15
Nodes (12): Bônus de pênalti (`points_penalty`), Campos (tabela `groups`), Configuração de pontuação e visibilidade por grupo, `exact_hits` no leaderboard, Gate por `(competição, fase)` — fonte de verdade `competitions.penalty_phases`, Invariantes (validadas na API **e** no front), Modo 1X2 (`points_exact = 0`), Observabilidade (+4 more)

### Community 25 - "Dashboard Page Tests (legacy)"
Cohesion: 0.21
Nodes (8): DashboardPageProps, dialog, fetchSpy, mockTrackEvent, user, User, buildApiUrl(), isAbsoluteUrl()

### Community 26 - "Button Component"
Cohesion: 0.17
Nodes (7): trackEvent(), HeaderProps, User, Member, MembersTabProps, members, mockTrackEvent

### Community 27 - "Google Login Button"
Cohesion: 0.24
Nodes (7): DashboardPage(), useDocumentTitle(), LoginPage(), mockTrackEvent, SettingsPage(), SettingsPageProps, User

### Community 28 - "Brand SVG Assets"
Cohesion: 0.17
Nodes (11): A. Ativar e verificar o GA4 em produção *(ação do dono — sem código)*, ⏸️ Adiado por design — só fazer quando o gatilho existir, B. Keyword research *(depende de tráfego acumular no Search Console)*, C. Bing Webmaster Tools *(ação do dono — sem código)*, context-seo.md — SEO, Performance & Analytics, Contexto do projeto (o que importa aqui), D. Link building *(ação do dono — sem código)*, ❌ Decisões descartadas — NÃO re-propor (+3 more)

### Community 29 - "Pages Function Proxy"
Cohesion: 0.18
Nodes (10): ApiCompetition, ApiMatch, ApiMatchesResponse, ApiTeam, COMP_TRANSLATIONS, mapStatus(), slugify(), SyncOptions (+2 more)

### Community 30 - "Web App Entry"
Cohesion: 0.22
Nodes (7): Captured, { db, captured }, { db, sqls }, m, match(), ScoreOverrides, team()

### Community 31 - "Icon SVG Assets"
Cohesion: 0.2
Nodes (7): JoinedGroup, JoinGroupModalProps, body, defaultProps, fetchSpy, joinedGroup, mockTrackEvent

### Community 32 - "API Vitest Config"
Cohesion: 0.2
Nodes (5): LeaderboardTabProps, Member, members, mockTrackEvent, UserPrediction

### Community 33 - "Web Vite Config"
Cohesion: 0.2
Nodes (7): Competition, CreatedGroup, CreateGroupModalProps, PRESET_LABELS, PRESET_VALUES, SCORING_HELP_TEXT, ScoringPreset

### Community 34 - "Vite Env Types"
Cohesion: 0.2
Nodes (9): API — Setup local, code:bash (cd api), code:bash (# Start local dev server (http://localhost:8787)), code:bash (# Set production secrets (one-time, stored encrypted in Clou), Deploying, First-time setup, Palpitae, Prerequisites (+1 more)

### Community 35 - "Web Test Setup"
Cohesion: 0.2
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 37 - "Group Detail Page Barrel"
Cohesion: 0.5
Nodes (6): matchGoesToPenalties(), parsePenaltyPhases(), calculatePenaltyBonus(), calculatePoints(), recalculateLeaderboard(), scoreMatch()

### Community 38 - "Login Page Barrel"
Cohesion: 0.39
Nodes (5): CacheEntry, fetchCachedJson(), invalidateApiCache(), responseCache, loader

### Community 39 - "Bracket Tab Barrel"
Cohesion: 0.25
Nodes (4): GroupCardProps, GroupWithStats, baseGroup, onClick

### Community 40 - "Community 40"
Cohesion: 0.29
Nodes (4): fetchSpy, mockTrackEvent, patchCall, user

### Community 41 - "Community 41"
Cohesion: 0.29
Nodes (6): Analytics — eventos de clique (GA4, lado cliente), code:ts (import { trackEvent } from '../../analytics/ga'), Convenções de nome, Eventos já mapeados, O que rastrear vs. ignorar, Regra

### Community 42 - "Community 42"
Cohesion: 0.53
Nodes (5): ActiveRound, pollActiveMatches(), maybeSyncResults(), scoreUnprocessedMatches(), syncFixtures()

### Community 43 - "Community 43"
Cohesion: 0.47
Nodes (4): env, fetchMatches(), main(), summarizeMatches()

### Community 44 - "Community 44"
Cohesion: 0.33
Nodes (3): CardProps, { container }, div

### Community 47 - "Community 47"
Cohesion: 0.5
Nodes (3): Analytics — eventos de clique (obrigatório), graphify, Observabilidade — eventos server-side (obrigatório)

### Community 48 - "Community 48"
Cohesion: 0.5
Nodes (3): Overview, System Architecture — Palpitae, Working with Architecture

## Knowledge Gaps
- **480 isolated node(s):** `PackageJson`, `env`, `ctx`, `app`, `Variables` (+475 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppContext` connect `Bracket UI Components` to `API Routers & Auth Middleware`, `Dashboard & Group Detail Pages`, `Predictions Tab (legacy)`, `Bracket API Router`, `Group Card Component`, `Group Detail Page Tests (legacy)`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `signJwt()` connect `Dashboard & Group Detail Pages` to `Bracket UI Components`, `API Routers & Auth Middleware`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `sendRoundReminders()` connect `Architecture Decision Records` to `Bracket UI Components`, `API Routers & Auth Middleware`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `PackageJson`, `env`, `ctx` to the rest of the system?**
  _480 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bracket UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `API Routers & Auth Middleware` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Auth Encoding & Google OAuth` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._