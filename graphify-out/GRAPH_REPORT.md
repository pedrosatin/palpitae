# Graph Report - palpitae  (2026-05-28)

## Corpus Check
- 96 files · ~31,887 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 667 nodes · 881 edges · 57 communities (53 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ce666ce8`
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
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]

## God Nodes (most connected - your core abstractions)
1. `🧠 Palpitae — Product Vision` - 23 edges
2. `config` - 17 edges
3. `🤖 AGENTS.md — Palpitae` - 16 edges
4. `AppContext` - 12 edges
5. `signJwt()` - 11 edges
6. `Entities` - 11 edges
7. `Palpitae — Grupos Privados de Previsão de Futebol` - 10 edges
8. `base64UrlEncode()` - 8 edges
9. `SlotData` - 8 edges
10. `Runtime Context` - 8 edges

## Surprising Connections (you probably didn't know these)
- `signJwt()` --calls--> `requestWithCookie()`  [EXTRACTED]
  api/src/auth/jwt.ts → api/src/auth/router.test.ts
- `base64UrlEncode()` --calls--> `signJwt()`  [EXTRACTED]
  api/src/auth/encoding.ts → api/src/auth/jwt.ts
- `base64UrlEncode()` --calls--> `generateState()`  [EXTRACTED]
  api/src/auth/encoding.ts → api/src/auth/google.ts
- `base64UrlEncode()` --calls--> `generateNonce()`  [EXTRACTED]
  api/src/auth/encoding.ts → api/src/auth/google.ts
- `base64UrlEncode()` --calls--> `generatePkce()`  [EXTRACTED]
  api/src/auth/encoding.ts → api/src/auth/google.ts

## Communities (57 total, 4 thin omitted)

### Community 0 - "Bracket UI Components"
Cohesion: 0.06
Nodes (48): base64UrlDecode(), base64UrlEncode(), buf, decoded, encoded, original, result, buildAuthUrl() (+40 more)

### Community 1 - "API Routers & Auth Middleware"
Cohesion: 0.05
Nodes (36): 🔐 Authentication, Backend (API), Competition, 📏 Constraints, 🧱 Core Product Concept, 🧠 Design Principles, ⚽ Domain Model, Excluded (future): (+28 more)

### Community 2 - "Auth Encoding & Google OAuth"
Cohesion: 0.11
Nodes (34): API Football (External Provider), Cloudflare D1 (SQLite), Cloudflare Pages, Cloudflare Workers, Runtime Context, Architecture Decision Records, Auth Domain Module, Competitions Domain Module (+26 more)

### Community 3 - "Architecture Decision Records"
Cohesion: 0.07
Nodes (29): ADR-001: Database Platform — Cloudflare D1, ADR-002: Migration Strategy — Wrangler D1 Migrations, ADR-003: API Runtime — Cloudflare Workers + Hono, ADR-004: Prediction Locking — Derived at Runtime, ADR-005: Authentication — Direct Google OAuth 2.0, ADR-006: Frontend Stack — Vite + React (Static Site), Architecture Decision Records, Consequences (+21 more)

### Community 4 - "Create Group Modal (legacy)"
Cohesion: 0.08
Nodes (16): DashboardPageProps, dialog, fetchSpy, user, User, GroupDetail, GroupDetailPage(), GroupDetailPageProps (+8 more)

### Community 5 - "Dashboard & Group Detail Pages"
Cohesion: 0.07
Nodes (25): allPicksBySlot, allPicksResult, byPos, competitionId, data, groupId, KNOCKOUT_PHASES, KnockoutPhase (+17 more)

### Community 6 - "Predictions Tab (legacy)"
Cohesion: 0.11
Nodes (14): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, input, pastMatch, saveBtn (+6 more)

### Community 7 - "Bracket API Router"
Cohesion: 0.09
Nodes (20): FEATURE_ALLOWLISTS, FEATURE_KEYS, FeatureFlags, FeatureKey, getFeatureFlags(), hasFeatureAccess(), body, candidate (+12 more)

### Community 8 - "App Entry & Login"
Cohesion: 0.09
Nodes (18): buildMyPicksMap(), getAvailableTeams(), getChildPositions(), allTeams, base, final, flipped, kept (+10 more)

### Community 9 - "Match Card Component"
Cohesion: 0.11
Nodes (17): code:mermaid (erDiagram), code:sql (PRAGMA foreign_keys = ON;), `competitions`, Database Schema — Palpitae, Entities, Entity Relationship Diagram, `group_members`, `groups` (+9 more)

### Community 10 - "Predictions Tab Component"
Cohesion: 0.11
Nodes (17): ✅ Alta Confiança, Anti-Abuse Strategy (MVP), ⚠️ Corrigido, ✅ In Scope, Key Assumptions to Validate, MVP Scope, Next Steps, Not Doing (and Why) (+9 more)

### Community 11 - "Group Card (legacy)"
Cohesion: 0.26
Nodes (11): clearInvalidatedPicks(), BracketTabProps, HALF_SLOTS, LEFT_BRACKET_ROUNDS, PREV_ROUND, RIGHT_BRACKET_ROUNDS, ROUND_LABELS, BracketData (+3 more)

### Community 12 - "Group Card Component"
Cohesion: 0.12
Nodes (16): 🤖 AGENTS.md — Palpitae, ⚠️ Anti-Patterns (Avoid), 🏗️ Architecture Guidelines, 🧩 Code Guidelines, 🗄️ Database Rules, ⚽ Domain Rules (Critical), 🧠 General Principles, 🎯 Goal (+8 more)

### Community 13 - "Fixture Sync (API Football)"
Cohesion: 0.14
Nodes (8): BracketSlotCardProps, cascadeAvailable, { container }, memberPick, mp, onPick, AvailableTeamsResult, BracketMatch

### Community 14 - "Create Group Modal"
Cohesion: 0.16
Nodes (3): JoinedGroup, JoinGroupModalProps, config

### Community 15 - "Button & Header (legacy)"
Cohesion: 0.13
Nodes (8): JoinedGroup, JoinGroupModalProps, body, defaultProps, fetchSpy, joinedGroup, ModalProps, onClose

### Community 16 - "Join Group Modal"
Cohesion: 0.15
Nodes (8): Team, TeamPickerProps, argBtn, available, buttons, onPick, teamsA, teamsB

### Community 17 - "Header Tests (legacy)"
Cohesion: 0.15
Nodes (8): HeaderProps, baseUser, link, onCreateGroup, onJoinGroup, onLogout, sairBtn, User

### Community 18 - "Group Detail Page Tests (legacy)"
Cohesion: 0.19
Nodes (8): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, input, pastMatch, saveBtn

### Community 19 - "Group Detail Page (legacy)"
Cohesion: 0.26
Nodes (8): authRouter, fakeEnv(), requestWithCookie(), router, app, AppContext, Env, Variables

### Community 20 - "Modal (legacy)"
Cohesion: 0.2
Nodes (6): PredictionMap, PredictionsTabProps, makeMatch(), matches, select, twoRoundMatches()

### Community 21 - "Card (legacy)"
Cohesion: 0.18
Nodes (6): BracketColumnProps, ROUND_INDEX, column, { container }, slots, SlotData

### Community 22 - "Card Component"
Cohesion: 0.18
Nodes (4): GroupCardProps, GroupWithStats, baseGroup, onClick

### Community 23 - "Modal Component"
Cohesion: 0.2
Nodes (6): GroupCardProps, GroupWithStats, baseGroup, onClick, DashboardPageProps, User

### Community 24 - "Team Badge Component"
Cohesion: 0.18
Nodes (7): Competition, CreatedGroup, CreateGroupModalProps, GroupDetail, GroupDetailPageProps, Tab, User

### Community 25 - "Dashboard Page Tests (legacy)"
Cohesion: 0.24
Nodes (9): ApiCompetition, ApiMatch, ApiMatchesResponse, ApiTeam, mapStatus(), slugify(), syncFixtures(), SyncOptions (+1 more)

### Community 26 - "Button Component"
Cohesion: 0.2
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 27 - "Google Login Button"
Cohesion: 0.2
Nodes (6): Competition, CreatedGroup, CreateGroupModalProps, competitions, createdGroup, defaultProps

### Community 28 - "Brand SVG Assets"
Cohesion: 0.22
Nodes (9): API — Setup local, code:bash (cd api), code:bash (# Start local dev server (http://localhost:8787)), code:bash (# Set production secrets (one-time, stored encrypted in Clou), Deploying, First-time setup, Palpitae, Prerequisites (+1 more)

### Community 29 - "Pages Function Proxy"
Cohesion: 0.22
Nodes (4): ButtonProps, onClick, HeaderProps, User

### Community 30 - "Web App Entry"
Cohesion: 0.25
Nodes (7): groupId, match, matchId, now, params, router, userId

### Community 31 - "Icon SVG Assets"
Cohesion: 0.25
Nodes (7): competition, competitionId, params, round, router, status, validStatuses

### Community 32 - "API Vitest Config"
Cohesion: 0.25
Nodes (3): CardProps, { container }, div

### Community 33 - "Web Vite Config"
Cohesion: 0.25
Nodes (6): baseUser, link, onCreateGroup, onJoinGroup, onLogout, sairBtn

### Community 34 - "Vite Env Types"
Cohesion: 0.38
Nodes (4): requireAuth, app, fakeEnv(), requestWithCookie()

### Community 35 - "Web Test Setup"
Cohesion: 0.29
Nodes (4): baseGroup, baseUser, fetchSpy, spy

### Community 36 - "Dashboard Page Barrel"
Cohesion: 0.33
Nodes (3): CardProps, { container }, div

### Community 38 - "Login Page Barrel"
Cohesion: 0.33
Nodes (3): TeamBadgeProps, { container }, img

### Community 39 - "Bracket Tab Barrel"
Cohesion: 0.33
Nodes (3): AuthStatus, User, rootEl

### Community 41 - "Community 41"
Cohesion: 0.4
Nodes (4): body, defaultProps, fetchSpy, joinedGroup

### Community 42 - "Community 42"
Cohesion: 0.4
Nodes (3): dialog, fetchSpy, user

### Community 43 - "Community 43"
Cohesion: 0.4
Nodes (3): competitions, createdGroup, defaultProps

### Community 44 - "Community 44"
Cohesion: 0.5
Nodes (3): Overview, System Architecture — Palpitae, Working with Architecture

### Community 45 - "Community 45"
Cohesion: 0.67
Nodes (3): Logo 2 SVG, Logo SVG (Logo.svg), Logo Text SVG

## Knowledge Gaps
- **349 isolated node(s):** `Env`, `Variables`, `app`, `ALGORITHM`, `JwtPayload` (+344 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `config` connect `Create Group Modal` to `Create Group Modal (legacy)`, `Predictions Tab (legacy)`, `Bracket Tab Barrel`, `Group Card (legacy)`, `Button & Header (legacy)`, `Group Detail Page Tests (legacy)`, `Modal (legacy)`, `Modal Component`, `Team Badge Component`, `Google Login Button`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `SlotData` connect `Card (legacy)` to `App Entry & Login`, `Group Card (legacy)`, `Fixture Sync (API Football)`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `AppContext` connect `Group Detail Page (legacy)` to `Bracket UI Components`, `Vite Env Types`, `Dashboard & Group Detail Pages`, `Bracket API Router`, `Web App Entry`, `Icon SVG Assets`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `Env`, `Variables`, `app` to the rest of the system?**
  _349 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bracket UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `API Routers & Auth Middleware` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Auth Encoding & Google OAuth` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._