# Graph Report - palpitae  (2026-06-17)

## Corpus Check
- 124 files · ~56,818 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1037 nodes · 1864 edges · 69 communities (63 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e394443b`
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

## God Nodes (most connected - your core abstractions)
1. `config` - 35 edges
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
- `pollActiveMatches()` --calls--> `scoreUnprocessedMatches()`  [EXTRACTED]
  api/src/matches/poller.ts → /home/satin/Work/palpitae/api/src/matches/scoring.ts
- `maybeSyncResults()` --calls--> `scoreUnprocessedMatches()`  [EXTRACTED]
  api/src/matches/router.ts → /home/satin/Work/palpitae/api/src/matches/scoring.ts
- `scheduled()` --calls--> `pollActiveMatches()`  [EXTRACTED]
  api/src/index.ts → api/src/matches/poller.ts
- `base64UrlEncode()` --calls--> `signJwt()`  [EXTRACTED]
  /home/satin/Work/palpitae/api/src/auth/encoding.ts → /home/satin/Work/palpitae/api/src/auth/jwt.ts
- `base64UrlDecode()` --calls--> `verifyGoogleIdToken()`  [EXTRACTED]
  /home/satin/Work/palpitae/api/src/auth/encoding.ts → /home/satin/Work/palpitae/api/src/auth/google.ts

## Communities (69 total, 6 thin omitted)

### Community 0 - "Bracket UI Components"
Cohesion: 0.05
Nodes (76): base64UrlDecode(), buf, decoded, encoded, original, result, ALGORITHM, importKey() (+68 more)

### Community 1 - "API Routers & Auth Middleware"
Cohesion: 0.06
Nodes (67): BracketColumn(), BracketColumnProps, ROUND_INDEX, column, { container }, renderColumn(), slot(), slots (+59 more)

### Community 2 - "Auth Encoding & Google OAuth"
Cohesion: 0.05
Nodes (54): ActiveRound, pollActiveMatches(), ActiveRow, db, [earliestOver, stillRelevant], matchdays, scoreMock, syncFixturesMock (+46 more)

### Community 3 - "Architecture Decision Records"
Cohesion: 0.07
Nodes (30): defaultRoundIndex(), GroupMember, GroupPicksResponse, GroupPicksTab(), GroupPicksTabProps, MemberPrediction, GroupPicksResponse, makeMatch() (+22 more)

### Community 4 - "Create Group Modal (legacy)"
Cohesion: 0.07
Nodes (43): API Football (External Provider), Cloudflare D1 (SQLite), Cloudflare Pages, Cloudflare Workers, Architecture Decision Records, Auth Domain Module, Competitions Domain Module, Groups Domain Module (+35 more)

### Community 5 - "Dashboard & Group Detail Pages"
Cohesion: 0.08
Nodes (16): DashboardPageProps, User, GroupDetail, GroupDetailPage(), GroupDetailPageProps, parseTab(), Tab, TABS (+8 more)

### Community 6 - "Predictions Tab (legacy)"
Cohesion: 0.05
Nodes (36): 🔐 Authentication, Backend (API), Competition, 📏 Constraints, 🧱 Core Product Concept, 🧠 Design Principles, ⚽ Domain Model, Excluded (future): (+28 more)

### Community 7 - "Bracket API Router"
Cohesion: 0.15
Nodes (28): base64UrlEncode(), buildAuthUrl(), exchangeCode(), generateNonce(), generatePkce(), generateState(), GoogleIdTokenClaims, GoogleUserInfo (+20 more)

### Community 8 - "App Entry & Login"
Cohesion: 0.12
Nodes (28): FEATURE_ALLOWLISTS, FEATURE_KEYS, FeatureFlags, FeatureKey, getFeatureFlags(), hasFeatureAccess(), body, candidate (+20 more)

### Community 9 - "Match Card Component"
Cohesion: 0.13
Nodes (28): byMatch, groupId, importStatements, locked, match, matchId, matchIds, matchRows (+20 more)

### Community 10 - "Predictions Tab Component"
Cohesion: 0.11
Nodes (14): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, input, pastMatch, saveBtn (+6 more)

### Community 11 - "Group Card (legacy)"
Cohesion: 0.13
Nodes (10): GroupCard(), GroupCardProps, GroupWithStats, baseGroup, onClick, BrowserFrame(), FeatureRow(), LandingPage() (+2 more)

### Community 12 - "Group Card Component"
Cohesion: 0.11
Nodes (17): code:mermaid (erDiagram), code:sql (PRAGMA foreign_keys = ON;), `competitions`, Database Schema — Palpitae, Entities, Entity Relationship Diagram, `group_members`, `groups` (+9 more)

### Community 13 - "Fixture Sync (API Football)"
Cohesion: 0.11
Nodes (17): ✅ Alta Confiança, Anti-Abuse Strategy (MVP), ⚠️ Corrigido, ✅ In Scope, Key Assumptions to Validate, MVP Scope, Next Steps, Not Doing (and Why) (+9 more)

### Community 14 - "Create Group Modal"
Cohesion: 0.16
Nodes (11): app, cacheHeaderFor(), counter, createMatchesDbMock(), env, fakeEnv(), first, second (+3 more)

### Community 15 - "Button & Header (legacy)"
Cohesion: 0.12
Nodes (16): 🤖 AGENTS.md — Palpitae, ⚠️ Anti-Patterns (Avoid), 🏗️ Architecture Guidelines, 🧩 Code Guidelines, 🗄️ Database Rules, ⚽ Domain Rules (Critical), 🧠 General Principles, 🎯 Goal (+8 more)

### Community 16 - "Join Group Modal"
Cohesion: 0.24
Nodes (13): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, awayInput, homeInput, input (+5 more)

### Community 17 - "Header Tests (legacy)"
Cohesion: 0.15
Nodes (4): App(), AuthStatus, User, rootEl

### Community 18 - "Group Detail Page Tests (legacy)"
Cohesion: 0.13
Nodes (9): GroupCardProps, GroupWithStats, baseGroup, onClick, DashboardPageProps, dialog, fetchSpy, user (+1 more)

### Community 19 - "Group Detail Page (legacy)"
Cohesion: 0.23
Nodes (8): GoogleLoginButton(), GoogleLogo(), Member, MembersTab(), MembersTabProps, buildApiUrl(), config, isAbsoluteUrl()

### Community 20 - "Modal (legacy)"
Cohesion: 0.2
Nodes (10): Header(), HeaderProps, baseUser, link, onCreateGroup, onJoinGroup, onLogout, renderHeader() (+2 more)

### Community 21 - "Card (legacy)"
Cohesion: 0.13
Nodes (8): JoinedGroup, JoinGroupModalProps, body, defaultProps, fetchSpy, joinedGroup, ModalProps, onClose

### Community 22 - "Card Component"
Cohesion: 0.22
Nodes (8): JoinedGroup, JoinGroupModal(), JoinGroupModalProps, formatDate(), LeaderboardTab(), LeaderboardTabProps, Member, UserPrediction

### Community 23 - "Modal Component"
Cohesion: 0.15
Nodes (13): ADR-006: Frontend Stack — Vite + React (Static Site), Consequences, Consequences, Consequences, Consequences, Context, Context, Decision (+5 more)

### Community 24 - "Team Badge Component"
Cohesion: 0.15
Nodes (8): GroupDetail, GroupDetailPageProps, Tab, baseGroup, baseUser, fetchSpy, spy, User

### Community 25 - "Dashboard Page Tests (legacy)"
Cohesion: 0.27
Nodes (8): Competition, CreatedGroup, CreateGroupModal(), CreateGroupModalProps, competitions, createdGroup, defaultProps, mockFetchCompetitions()

### Community 26 - "Button Component"
Cohesion: 0.17
Nodes (3): CardProps, { container }, div

### Community 27 - "Google Login Button"
Cohesion: 0.18
Nodes (10): 2. `StandingsTab.tsx` — componente principal, 3. `StandingsTab.test.tsx` — testes, 4. `index.ts` — barrel export, code:ts (const groupMatches = matches.filter((m) => m.group_name !== ), code:ts (interface TeamStanding {), code:ts (const [selectedGroup, setSelectedGroup] = useState<string | ), code:block13 ([Grupo A]                          ← header clicável → abre ), code:ts (export { default } from './StandingsTab') (+2 more)

### Community 28 - "Brand SVG Assets"
Cohesion: 0.2
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 29 - "Pages Function Proxy"
Cohesion: 0.2
Nodes (10): 1. `api/wrangler.toml` — adicionar Cron Trigger, 2. `api/src/matches/poller.ts` (implementado), 3. `api/src/index.ts` — exportar handler `scheduled`, 3. `api/src/index.ts` — handler `scheduled` (implementado), 4. `api/src/matches/router.ts` — sem mudança, 4. `api/src/matches/router.ts` — sem mudança agora, Arquivos a modificar, code:block2 (web/src/pages/GroupDetailPage/GroupDetailPage.tsx) (+2 more)

### Community 30 - "Web App Entry"
Cohesion: 0.2
Nodes (6): Competition, CreatedGroup, CreateGroupModalProps, competitions, createdGroup, defaultProps

### Community 31 - "Icon SVG Assets"
Cohesion: 0.2
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 32 - "API Vitest Config"
Cohesion: 0.22
Nodes (9): ADR-007: Result Sync Strategy — Cron-Triggered Time-Window Poller, Alternatives Considered, code:block1 (First half:           45 min), code:sql (SELECT DISTINCT c.id AS comp_id, c.external_id, c.season, m.), Consequences, Consequences, Context, Decision (+1 more)

### Community 33 - "Web Vite Config"
Cohesion: 0.22
Nodes (9): API externa, Arquivos novos a criar, Arquivos relevantes, context.md — Tarefa atual: Result Sync & Scoring, Cooldown / proteção de rate limit, Fluxo acordado, Leaderboard, Mudanças no schema (migração necessária) (+1 more)

### Community 34 - "Vite Env Types"
Cohesion: 0.22
Nodes (4): ButtonProps, onClick, HeaderProps, User

### Community 35 - "Web Test Setup"
Cohesion: 0.36
Nodes (4): Card(), CardProps, { container }, div

### Community 36 - "Dashboard Page Barrel"
Cohesion: 0.36
Nodes (4): Modal(), ModalProps, onClose, renderModal()

### Community 37 - "Group Detail Page Barrel"
Cohesion: 0.25
Nodes (8): Arquivos a criar, Arquivos tocados, code:block1 (web/src/components/StandingsTab/), Decisões, Janela de tempo, Objetivo, Próximos passos (após estabilizar o Cron), Tarefa atual: Cron Poller de Resultados

### Community 38 - "Login Page Barrel"
Cohesion: 0.36
Nodes (4): TeamBadge(), TeamBadgeProps, { container }, img

### Community 39 - "Bracket Tab Barrel"
Cohesion: 0.25
Nodes (6): baseUser, link, onCreateGroup, onJoinGroup, onLogout, sairBtn

### Community 40 - "Community 40"
Cohesion: 0.57
Nodes (5): env, fetchMatches(), loadDevVars(), main(), summarizeMatches()

### Community 41 - "Community 41"
Cohesion: 0.38
Nodes (3): Button(), ButtonProps, onClick

### Community 42 - "Community 42"
Cohesion: 0.29
Nodes (7): code:ts (export interface Match {), Convenções do projeto, Decisões tomadas, O que NÃO fazer, Status, Tarefa: Aba "Grupos" — Classificação da fase de grupos, Tipos relevantes já existentes

### Community 43 - "Community 43"
Cohesion: 0.33
Nodes (6): 1. `GroupDetailPage.tsx` — adicionar a aba, 2. Novo arquivo: `api/src/matches/poller.ts`, code:ts (const TABS = [), code:tsx (<button), code:ts (import StandingsTab from '../../components/StandingsTab'), Como testar localmente

### Community 44 - "Community 44"
Cohesion: 0.53
Nodes (4): body, defaultProps, fetchSpy, joinedGroup

### Community 45 - "Community 45"
Cohesion: 0.33
Nodes (5): ADR-001: Database Platform — Cloudflare D1, Architecture Decision Records, Consequences, Context, Decision

### Community 46 - "Community 46"
Cohesion: 0.53
Nodes (4): dialog, fetchSpy, mockResponse(), user

### Community 48 - "Community 48"
Cohesion: 0.4
Nodes (3): Overview, System Architecture — Palpitae, Working with Architecture

### Community 49 - "Community 49"
Cohesion: 0.4
Nodes (5): ADR-005: Authentication — Direct Google OAuth 2.0, Consequences, Context, Decision, Security Requirements

### Community 50 - "Community 50"
Cohesion: 0.4
Nodes (5): ADR-002: Migration Strategy — Wrangler D1 Migrations, Consequences, Context, Decision, Rules

### Community 51 - "Community 51"
Cohesion: 0.5
Nodes (4): ADR-003: API Runtime — Cloudflare Workers + Hono, Consequences, Context, Decision

### Community 52 - "Community 52"
Cohesion: 0.5
Nodes (4): ADR-008: Caching Strategy for `GET /matches` — Content-Derived TTL + Edge Cache API, Consequences, Context, Decision

### Community 53 - "Community 53"
Cohesion: 0.5
Nodes (4): ADR-004: Prediction Locking — Derived at Runtime, Consequences, Context, Decision

### Community 55 - "Community 55"
Cohesion: 0.67
Nodes (3): Logo 2 SVG, Logo SVG (Logo.svg), Logo Text SVG

## Knowledge Gaps
- **250 isolated node(s):** `app`, `TEAM_TRANSLATIONS`, `COMP_TRANSLATIONS`, `ApiTeam`, `ApiMatch` (+245 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `config` connect `Group Detail Page (legacy)` to `API Routers & Auth Middleware`, `Architecture Decision Records`, `Dashboard & Group Detail Pages`, `Predictions Tab Component`, `Community 46`, `Join Group Modal`, `Header Tests (legacy)`, `Group Detail Page Tests (legacy)`, `Card (legacy)`, `Card Component`, `Team Badge Component`, `Dashboard Page Tests (legacy)`, `Button Component`, `Web App Entry`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `AppContext` connect `Bracket UI Components` to `Auth Encoding & Google OAuth`, `Bracket API Router`, `App Entry & Login`, `Match Card Component`, `Create Group Modal`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `requireAuth` connect `Bracket UI Components` to `App Entry & Login`, `Match Card Component`, `Auth Encoding & Google OAuth`, `Bracket API Router`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `app`, `TEAM_TRANSLATIONS`, `COMP_TRANSLATIONS` to the rest of the system?**
  _250 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bracket UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `API Routers & Auth Middleware` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Auth Encoding & Google OAuth` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._