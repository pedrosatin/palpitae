# Graph Report - palpitae  (2026-06-17)

## Corpus Check
- 121 files · ~54,982 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 997 nodes · 1809 edges · 59 communities (53 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output

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
1. `config` - 34 edges
2. `AppContext` - 27 edges
3. `🧠 Palpitae — Product Vision` - 24 edges
4. `signJwt()` - 22 edges
5. `🤖 AGENTS.md — Palpitae` - 17 edges
6. `SlotData` - 16 edges
7. `ADR-006: Frontend Stack — Vite + React (Static Site)` - 15 edges
8. `requireAuth` - 14 edges
9. `Round` - 14 edges
10. `Team` - 14 edges

## Surprising Connections (you probably didn't know these)
- `scheduled()` --calls--> `pollActiveMatches()`  [EXTRACTED]
  api/src/index.ts → api/src/matches/poller.ts
- `pollActiveMatches()` --calls--> `scoreUnprocessedMatches()`  [EXTRACTED]
  api/src/matches/poller.ts → /home/satin/Work/palpitae/api/src/matches/scoring.ts
- `maybeSyncResults()` --calls--> `scoreUnprocessedMatches()`  [EXTRACTED]
  api/src/matches/router.ts → /home/satin/Work/palpitae/api/src/matches/scoring.ts
- `signJwt()` --calls--> `requestWithCookie()`  [EXTRACTED]
  /home/satin/Work/palpitae/api/src/auth/jwt.ts → /home/satin/Work/palpitae/api/src/auth/router.test.ts
- `requestGroupPicks()` --calls--> `signJwt()`  [EXTRACTED]
  /home/satin/Work/palpitae/api/src/predictions/router.test.ts → /home/satin/Work/palpitae/api/src/auth/jwt.ts

## Communities (59 total, 6 thin omitted)

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
Cohesion: 0.06
Nodes (50): requireAuth, app, buildApp(), fakeEnv(), requestWithCookie(), fakeEnv(), requestWithCookie(), allPicksBySlot (+42 more)

### Community 4 - "Create Group Modal (legacy)"
Cohesion: 0.07
Nodes (45): ActiveRound, pollActiveMatches(), ActiveRow, db, [earliestOver, stillRelevant], matchdays, scoreMock, syncFixturesMock (+37 more)

### Community 5 - "Dashboard & Group Detail Pages"
Cohesion: 0.07
Nodes (43): API Football (External Provider), Cloudflare D1 (SQLite), Cloudflare Pages, Cloudflare Workers, Architecture Decision Records, Auth Domain Module, Competitions Domain Module, Groups Domain Module (+35 more)

### Community 6 - "Predictions Tab (legacy)"
Cohesion: 0.09
Nodes (41): byMatch, groupId, importStatements, locked, match, matchId, matchIds, matchRows (+33 more)

### Community 7 - "Bracket API Router"
Cohesion: 0.08
Nodes (25): Competition, CreatedGroup, CreateGroupModal(), CreateGroupModalProps, competitions, createdGroup, defaultProps, mockFetchCompetitions() (+17 more)

### Community 8 - "App Entry & Login"
Cohesion: 0.05
Nodes (36): 🔐 Authentication, Backend (API), Competition, 📏 Constraints, 🧱 Core Product Concept, 🧠 Design Principles, ⚽ Domain Model, Excluded (future): (+28 more)

### Community 9 - "Match Card Component"
Cohesion: 0.11
Nodes (31): FEATURE_ALLOWLISTS, FEATURE_KEYS, FeatureFlags, FeatureKey, getFeatureFlags(), hasFeatureAccess(), body, candidate (+23 more)

### Community 10 - "Predictions Tab Component"
Cohesion: 0.07
Nodes (30): 1. `api/wrangler.toml` — adicionar Cron Trigger, 2. `api/src/matches/poller.ts` (implementado), 2. Novo arquivo: `api/src/matches/poller.ts`, 3. `api/src/index.ts` — exportar handler `scheduled`, 3. `api/src/index.ts` — handler `scheduled` (implementado), 4. `api/src/matches/router.ts` — sem mudança, 4. `api/src/matches/router.ts` — sem mudança agora, API externa (+22 more)

### Community 11 - "Group Card (legacy)"
Cohesion: 0.11
Nodes (14): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, input, pastMatch, saveBtn (+6 more)

### Community 12 - "Group Card Component"
Cohesion: 0.13
Nodes (10): GroupCard(), GroupCardProps, GroupWithStats, baseGroup, onClick, BrowserFrame(), FeatureRow(), LandingPage() (+2 more)

### Community 13 - "Fixture Sync (API Football)"
Cohesion: 0.17
Nodes (12): dialog, fetchSpy, mockResponse(), user, GoogleLoginButton(), GoogleLogo(), Member, MembersTab() (+4 more)

### Community 14 - "Create Group Modal"
Cohesion: 0.11
Nodes (17): code:mermaid (erDiagram), code:sql (PRAGMA foreign_keys = ON;), `competitions`, Database Schema — Palpitae, Entities, Entity Relationship Diagram, `group_members`, `groups` (+9 more)

### Community 15 - "Button & Header (legacy)"
Cohesion: 0.11
Nodes (17): ✅ Alta Confiança, Anti-Abuse Strategy (MVP), ⚠️ Corrigido, ✅ In Scope, Key Assumptions to Validate, MVP Scope, Next Steps, Not Doing (and Why) (+9 more)

### Community 16 - "Join Group Modal"
Cohesion: 0.24
Nodes (13): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, awayInput, homeInput, input (+5 more)

### Community 17 - "Header Tests (legacy)"
Cohesion: 0.12
Nodes (16): 🤖 AGENTS.md — Palpitae, ⚠️ Anti-Patterns (Avoid), 🏗️ Architecture Guidelines, 🧩 Code Guidelines, 🗄️ Database Rules, ⚽ Domain Rules (Critical), 🧠 General Principles, 🎯 Goal (+8 more)

### Community 18 - "Group Detail Page Tests (legacy)"
Cohesion: 0.15
Nodes (4): App(), AuthStatus, User, rootEl

### Community 19 - "Group Detail Page (legacy)"
Cohesion: 0.13
Nodes (9): GroupCardProps, GroupWithStats, baseGroup, onClick, DashboardPageProps, dialog, fetchSpy, user (+1 more)

### Community 20 - "Modal (legacy)"
Cohesion: 0.13
Nodes (8): JoinedGroup, JoinGroupModalProps, body, defaultProps, fetchSpy, joinedGroup, ModalProps, onClose

### Community 21 - "Card (legacy)"
Cohesion: 0.15
Nodes (8): GroupDetail, GroupDetailPageProps, Tab, baseGroup, baseUser, fetchSpy, spy, User

### Community 22 - "Card Component"
Cohesion: 0.15
Nodes (13): ADR-006: Frontend Stack — Vite + React (Static Site), Consequences, Consequences, Consequences, Consequences, Context, Context, Decision (+5 more)

### Community 23 - "Modal Component"
Cohesion: 0.17
Nodes (3): CardProps, { container }, div

### Community 24 - "Team Badge Component"
Cohesion: 0.2
Nodes (6): Competition, CreatedGroup, CreateGroupModalProps, competitions, createdGroup, defaultProps

### Community 25 - "Dashboard Page Tests (legacy)"
Cohesion: 0.2
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 26 - "Button Component"
Cohesion: 0.2
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 27 - "Google Login Button"
Cohesion: 0.22
Nodes (4): ButtonProps, onClick, HeaderProps, User

### Community 28 - "Brand SVG Assets"
Cohesion: 0.22
Nodes (9): ADR-007: Result Sync Strategy — Cron-Triggered Time-Window Poller, Alternatives Considered, code:block1 (First half:           45 min), code:sql (SELECT DISTINCT c.id AS comp_id, c.external_id, c.season, m.), Consequences, Consequences, Context, Decision (+1 more)

### Community 29 - "Pages Function Proxy"
Cohesion: 0.36
Nodes (4): TeamBadge(), TeamBadgeProps, { container }, img

### Community 30 - "Web App Entry"
Cohesion: 0.36
Nodes (4): Card(), CardProps, { container }, div

### Community 31 - "Icon SVG Assets"
Cohesion: 0.36
Nodes (4): Modal(), ModalProps, onClose, renderModal()

### Community 32 - "API Vitest Config"
Cohesion: 0.25
Nodes (6): baseUser, link, onCreateGroup, onJoinGroup, onLogout, sairBtn

### Community 33 - "Web Vite Config"
Cohesion: 0.57
Nodes (5): env, fetchMatches(), loadDevVars(), main(), summarizeMatches()

### Community 34 - "Vite Env Types"
Cohesion: 0.48
Nodes (5): formatDate(), LeaderboardTab(), LeaderboardTabProps, Member, UserPrediction

### Community 35 - "Web Test Setup"
Cohesion: 0.38
Nodes (3): Button(), ButtonProps, onClick

### Community 36 - "Dashboard Page Barrel"
Cohesion: 0.33
Nodes (5): ADR-003: API Runtime — Cloudflare Workers + Hono, Architecture Decision Records, Consequences, Context, Decision

### Community 38 - "Login Page Barrel"
Cohesion: 0.4
Nodes (3): Overview, System Architecture — Palpitae, Working with Architecture

### Community 39 - "Bracket Tab Barrel"
Cohesion: 0.4
Nodes (5): ADR-002: Migration Strategy — Wrangler D1 Migrations, Consequences, Context, Decision, Rules

### Community 40 - "Community 40"
Cohesion: 0.4
Nodes (5): ADR-005: Authentication — Direct Google OAuth 2.0, Consequences, Context, Decision, Security Requirements

### Community 41 - "Community 41"
Cohesion: 0.5
Nodes (4): ADR-008: Caching Strategy for `GET /matches` — Content-Derived TTL + Edge Cache API, Consequences, Context, Decision

### Community 42 - "Community 42"
Cohesion: 0.5
Nodes (4): ADR-001: Database Platform — Cloudflare D1, Consequences, Context, Decision

### Community 43 - "Community 43"
Cohesion: 0.5
Nodes (4): ADR-004: Prediction Locking — Derived at Runtime, Consequences, Context, Decision

### Community 45 - "Community 45"
Cohesion: 0.67
Nodes (3): Logo 2 SVG, Logo SVG (Logo.svg), Logo Text SVG

## Knowledge Gaps
- **234 isolated node(s):** `app`, `TEAM_TRANSLATIONS`, `COMP_TRANSLATIONS`, `ApiTeam`, `ApiMatch` (+229 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `config` connect `Fixture Sync (API Football)` to `Bracket UI Components`, `API Routers & Auth Middleware`, `Vite Env Types`, `Bracket API Router`, `Group Card (legacy)`, `Join Group Modal`, `Group Detail Page Tests (legacy)`, `Group Detail Page (legacy)`, `Modal (legacy)`, `Card (legacy)`, `Modal Component`, `Team Badge Component`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `AppContext` connect `Architecture Decision Records` to `Match Card Component`, `Auth Encoding & Google OAuth`, `Create Group Modal (legacy)`, `Predictions Tab (legacy)`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `app`, `TEAM_TRANSLATIONS`, `COMP_TRANSLATIONS` to the rest of the system?**
  _234 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bracket UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `API Routers & Auth Middleware` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Auth Encoding & Google OAuth` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Architecture Decision Records` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._