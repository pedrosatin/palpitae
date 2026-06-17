# Graph Report - palpitae  (2026-06-16)

## Corpus Check
- 121 files · ~53,933 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 977 nodes · 1786 edges · 56 communities (50 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1a14f24c`
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

## God Nodes (most connected - your core abstractions)
1. `config` - 34 edges
2. `AppContext` - 27 edges
3. `🧠 Palpitae — Product Vision` - 24 edges
4. `signJwt()` - 22 edges
5. `🤖 AGENTS.md — Palpitae` - 17 edges
6. `SlotData` - 16 edges
7. `requireAuth` - 14 edges
8. `Round` - 14 edges
9. `Team` - 14 edges
10. `base64UrlEncode()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `maybeSyncResults()` --calls--> `syncFixtures()`  [EXTRACTED]
  /home/satin/Work/palpitae/api/src/matches/router.ts → api/src/matches/sync.ts
- `pollActiveMatches()` --calls--> `scoreUnprocessedMatches()`  [EXTRACTED]
  api/src/matches/poller.ts → /home/satin/Work/palpitae/api/src/matches/scoring.ts
- `scheduled()` --calls--> `pollActiveMatches()`  [EXTRACTED]
  api/src/index.ts → api/src/matches/poller.ts
- `signJwt()` --calls--> `requestWithCookie()`  [EXTRACTED]
  /home/satin/Work/palpitae/api/src/auth/jwt.ts → /home/satin/Work/palpitae/api/src/auth/router.test.ts
- `requestGroupPicks()` --calls--> `signJwt()`  [EXTRACTED]
  /home/satin/Work/palpitae/api/src/predictions/router.test.ts → /home/satin/Work/palpitae/api/src/auth/jwt.ts

## Communities (56 total, 6 thin omitted)

### Community 0 - "Bracket UI Components"
Cohesion: 0.06
Nodes (67): BracketColumn(), BracketColumnProps, ROUND_INDEX, column, { container }, renderColumn(), slot(), slots (+59 more)

### Community 1 - "API Routers & Auth Middleware"
Cohesion: 0.05
Nodes (40): DashboardPageProps, User, GroupDetail, GroupDetailPage(), GroupDetailPageProps, parseTab(), Tab, TABS (+32 more)

### Community 2 - "Auth Encoding & Google OAuth"
Cohesion: 0.08
Nodes (53): base64UrlDecode(), base64UrlEncode(), buf, decoded, encoded, original, result, buildAuthUrl() (+45 more)

### Community 3 - "Architecture Decision Records"
Cohesion: 0.07
Nodes (43): API Football (External Provider), Cloudflare D1 (SQLite), Cloudflare Pages, Cloudflare Workers, Architecture Decision Records, Auth Domain Module, Competitions Domain Module, Groups Domain Module (+35 more)

### Community 4 - "Create Group Modal (legacy)"
Cohesion: 0.05
Nodes (43): ADR-001: Database Platform — Cloudflare D1, ADR-002: Migration Strategy — Wrangler D1 Migrations, ADR-003: API Runtime — Cloudflare Workers + Hono, ADR-004: Prediction Locking — Derived at Runtime, ADR-005: Authentication — Direct Google OAuth 2.0, ADR-006: Frontend Stack — Vite + React (Static Site), ADR-007: Result Sync Strategy — Cron-Triggered Time-Window Poller, Alternatives Considered (+35 more)

### Community 5 - "Dashboard & Group Detail Pages"
Cohesion: 0.08
Nodes (25): Competition, CreatedGroup, CreateGroupModal(), CreateGroupModalProps, competitions, createdGroup, defaultProps, mockFetchCompetitions() (+17 more)

### Community 6 - "Predictions Tab (legacy)"
Cohesion: 0.05
Nodes (36): 🔐 Authentication, Backend (API), Competition, 📏 Constraints, 🧱 Core Product Concept, 🧠 Design Principles, ⚽ Domain Model, Excluded (future): (+28 more)

### Community 7 - "Bracket API Router"
Cohesion: 0.11
Nodes (31): byMatch, groupId, importStatements, locked, match, matchId, matchIds, matchRows (+23 more)

### Community 8 - "App Entry & Login"
Cohesion: 0.12
Nodes (28): FEATURE_ALLOWLISTS, FEATURE_KEYS, FeatureFlags, FeatureKey, getFeatureFlags(), hasFeatureAccess(), body, candidate (+20 more)

### Community 9 - "Match Card Component"
Cohesion: 0.07
Nodes (30): 1. `api/wrangler.toml` — adicionar Cron Trigger, 2. `api/src/matches/poller.ts` (implementado), 2. Novo arquivo: `api/src/matches/poller.ts`, 3. `api/src/index.ts` — exportar handler `scheduled`, 3. `api/src/index.ts` — handler `scheduled` (implementado), 4. `api/src/matches/router.ts` — sem mudança, 4. `api/src/matches/router.ts` — sem mudança agora, API externa (+22 more)

### Community 10 - "Predictions Tab Component"
Cohesion: 0.12
Nodes (26): allPicksBySlot, allPicksResult, byPos, competitionId, data, ensureSlot(), groupId, KNOCKOUT_PHASES (+18 more)

### Community 11 - "Group Card (legacy)"
Cohesion: 0.18
Nodes (14): requireAuth, app, buildApp(), fakeEnv(), requestWithCookie(), fakeEnv(), requestWithCookie(), router (+6 more)

### Community 12 - "Group Card Component"
Cohesion: 0.11
Nodes (14): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, input, pastMatch, saveBtn (+6 more)

### Community 13 - "Fixture Sync (API Football)"
Cohesion: 0.16
Nodes (13): GoogleLoginButton(), GoogleLogo(), formatDate(), LeaderboardTab(), LeaderboardTabProps, Member, UserPrediction, Member (+5 more)

### Community 14 - "Create Group Modal"
Cohesion: 0.13
Nodes (10): GroupCard(), GroupCardProps, GroupWithStats, baseGroup, onClick, BrowserFrame(), FeatureRow(), LandingPage() (+2 more)

### Community 15 - "Button & Header (legacy)"
Cohesion: 0.12
Nodes (17): ActiveRow, db, [earliestOver, stillRelevant], matchdays, scoreMock, syncFixturesMock, ApiCompetition, ApiMatch (+9 more)

### Community 16 - "Join Group Modal"
Cohesion: 0.22
Nodes (14): ActiveRound, calculatePoints(), recalculateLeaderboard(), scoreMatch(), scoreUnprocessedMatches(), batchSpy, buildFakeDb(), db (+6 more)

### Community 17 - "Header Tests (legacy)"
Cohesion: 0.11
Nodes (17): code:mermaid (erDiagram), code:sql (PRAGMA foreign_keys = ON;), `competitions`, Database Schema — Palpitae, Entities, Entity Relationship Diagram, `group_members`, `groups` (+9 more)

### Community 18 - "Group Detail Page Tests (legacy)"
Cohesion: 0.11
Nodes (17): ✅ Alta Confiança, Anti-Abuse Strategy (MVP), ⚠️ Corrigido, ✅ In Scope, Key Assumptions to Validate, MVP Scope, Next Steps, Not Doing (and Why) (+9 more)

### Community 19 - "Group Detail Page (legacy)"
Cohesion: 0.12
Nodes (10): ButtonProps, onClick, HeaderProps, baseUser, link, onCreateGroup, onJoinGroup, onLogout (+2 more)

### Community 20 - "Modal (legacy)"
Cohesion: 0.24
Nodes (13): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, awayInput, homeInput, input (+5 more)

### Community 21 - "Card (legacy)"
Cohesion: 0.12
Nodes (16): 🤖 AGENTS.md — Palpitae, ⚠️ Anti-Patterns (Avoid), 🏗️ Architecture Guidelines, 🧩 Code Guidelines, 🗄️ Database Rules, ⚽ Domain Rules (Critical), 🧠 General Principles, 🎯 Goal (+8 more)

### Community 22 - "Card Component"
Cohesion: 0.13
Nodes (9): GroupCardProps, GroupWithStats, baseGroup, onClick, DashboardPageProps, dialog, fetchSpy, user (+1 more)

### Community 23 - "Modal Component"
Cohesion: 0.15
Nodes (4): App(), AuthStatus, User, rootEl

### Community 24 - "Team Badge Component"
Cohesion: 0.27
Nodes (13): body, BulkMockOptions, capturedSql, createBulkDbMock(), createGroupPicksDbMock(), db, fakeEnv(), GroupMockOptions (+5 more)

### Community 25 - "Dashboard Page Tests (legacy)"
Cohesion: 0.13
Nodes (8): JoinedGroup, JoinGroupModalProps, body, defaultProps, fetchSpy, joinedGroup, ModalProps, onClose

### Community 26 - "Button Component"
Cohesion: 0.15
Nodes (8): GroupDetail, GroupDetailPageProps, Tab, baseGroup, baseUser, fetchSpy, spy, User

### Community 27 - "Google Login Button"
Cohesion: 0.29
Nodes (10): competition, competitionId, dbStartedAt, maybeSyncResults(), params, round, router, startedAt (+2 more)

### Community 28 - "Brand SVG Assets"
Cohesion: 0.17
Nodes (3): CardProps, { container }, div

### Community 29 - "Pages Function Proxy"
Cohesion: 0.2
Nodes (6): Competition, CreatedGroup, CreateGroupModalProps, competitions, createdGroup, defaultProps

### Community 30 - "Web App Entry"
Cohesion: 0.2
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 31 - "Icon SVG Assets"
Cohesion: 0.2
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 32 - "API Vitest Config"
Cohesion: 0.36
Nodes (4): TeamBadge(), TeamBadgeProps, { container }, img

### Community 33 - "Web Vite Config"
Cohesion: 0.36
Nodes (4): Modal(), ModalProps, onClose, renderModal()

### Community 34 - "Vite Env Types"
Cohesion: 0.36
Nodes (4): Card(), CardProps, { container }, div

### Community 35 - "Web Test Setup"
Cohesion: 0.48
Nodes (5): app, createMatchesDbMock(), fakeEnv(), { syncFixturesSpy }, waitUntil

### Community 36 - "Dashboard Page Barrel"
Cohesion: 0.57
Nodes (5): env, fetchMatches(), loadDevVars(), main(), summarizeMatches()

### Community 37 - "Group Detail Page Barrel"
Cohesion: 0.38
Nodes (3): Button(), ButtonProps, onClick

### Community 38 - "Login Page Barrel"
Cohesion: 0.53
Nodes (4): dialog, fetchSpy, mockResponse(), user

### Community 40 - "Community 40"
Cohesion: 0.4
Nodes (3): Overview, System Architecture — Palpitae, Working with Architecture

### Community 42 - "Community 42"
Cohesion: 0.67
Nodes (3): Logo 2 SVG, Logo SVG (Logo.svg), Logo Text SVG

## Knowledge Gaps
- **222 isolated node(s):** `app`, `TEAM_TRANSLATIONS`, `COMP_TRANSLATIONS`, `ApiTeam`, `ApiMatch` (+217 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `config` connect `Fixture Sync (API Football)` to `Bracket UI Components`, `API Routers & Auth Middleware`, `Dashboard & Group Detail Pages`, `Login Page Barrel`, `Group Card Component`, `Modal (legacy)`, `Card Component`, `Modal Component`, `Dashboard Page Tests (legacy)`, `Button Component`, `Brand SVG Assets`, `Pages Function Proxy`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `AppContext` connect `Group Card (legacy)` to `Auth Encoding & Google OAuth`, `Web Test Setup`, `Bracket API Router`, `App Entry & Login`, `Predictions Tab Component`, `Team Badge Component`, `Google Login Button`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `app`, `TEAM_TRANSLATIONS`, `COMP_TRANSLATIONS` to the rest of the system?**
  _222 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bracket UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `API Routers & Auth Middleware` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Auth Encoding & Google OAuth` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Architecture Decision Records` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._