# Graph Report - .  (2026-05-27)

## Corpus Check
- Corpus is ~31,282 words - fits in a single context window. You may not need a graph.

## Summary
- 516 nodes · 716 edges · 40 communities (35 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.5)
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
- [[_COMMUNITY_Brand SVG Assets|Brand SVG Assets]]
- [[_COMMUNITY_Web App Entry|Web App Entry]]
- [[_COMMUNITY_Icon SVG Assets|Icon SVG Assets]]

## God Nodes (most connected - your core abstractions)
1. `AppContext` - 11 edges
2. `signJwt()` - 11 edges
3. `config` - 9 edges
4. `base64UrlEncode()` - 8 edges
5. `SlotData` - 8 edges
6. `Round` - 7 edges
7. `Team` - 7 edges
8. `base64UrlDecode()` - 6 edges
9. `requireAuth` - 6 edges
10. `getAvailableTeams()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `base64UrlEncode()` --calls--> `signJwt()`  [EXTRACTED]
  api/src/auth/encoding.ts → api/src/auth/jwt.ts
- `base64UrlDecode()` --calls--> `verifyJwt()`  [EXTRACTED]
  api/src/auth/encoding.ts → api/src/auth/jwt.ts
- `base64UrlEncode()` --calls--> `generateState()`  [EXTRACTED]
  api/src/auth/encoding.ts → api/src/auth/google.ts
- `base64UrlEncode()` --calls--> `generateNonce()`  [EXTRACTED]
  api/src/auth/encoding.ts → api/src/auth/google.ts
- `base64UrlEncode()` --calls--> `generatePkce()`  [EXTRACTED]
  api/src/auth/encoding.ts → api/src/auth/google.ts

## Communities (40 total, 5 thin omitted)

### Community 0 - "Bracket UI Components"
Cohesion: 0.05
Nodes (46): BracketColumnProps, ROUND_INDEX, column, { container }, slots, BracketSlotCardProps, cascadeAvailable, { container } (+38 more)

### Community 1 - "API Routers & Auth Middleware"
Cohesion: 0.05
Nodes (54): ALGORITHM, importKey(), JwtPayload, signJwt(), [, body], [h, , s], payload, tamperedBody (+46 more)

### Community 2 - "Auth Encoding & Google OAuth"
Cohesion: 0.06
Nodes (40): base64UrlDecode(), base64UrlEncode(), buf, decoded, encoded, original, result, buildAuthUrl() (+32 more)

### Community 3 - "Architecture Decision Records"
Cohesion: 0.12
Nodes (36): AGENTS.md, API Football (External Provider), CLAUDE.md, Cloudflare D1 (SQLite), Cloudflare Pages, Cloudflare Workers, Runtime Context, Architecture Decision Records (+28 more)

### Community 4 - "Create Group Modal (legacy)"
Cohesion: 0.06
Nodes (20): Competition, CreatedGroup, CreateGroupModalProps, competitions, createdGroup, defaultProps, HeaderProps, baseUser (+12 more)

### Community 5 - "Dashboard & Group Detail Pages"
Cohesion: 0.08
Nodes (16): DashboardPageProps, dialog, fetchSpy, user, User, GroupDetail, GroupDetailPage(), GroupDetailPageProps (+8 more)

### Community 6 - "Predictions Tab (legacy)"
Cohesion: 0.11
Nodes (14): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, input, pastMatch, saveBtn (+6 more)

### Community 7 - "Bracket API Router"
Cohesion: 0.08
Nodes (23): allPicksBySlot, allPicksResult, competitionId, data, groupId, KNOCKOUT_PHASES, KnockoutPhase, matchesResult (+15 more)

### Community 8 - "App Entry & Login"
Cohesion: 0.18
Nodes (4): AuthStatus, User, config, rootEl

### Community 9 - "Match Card Component"
Cohesion: 0.19
Nodes (8): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, input, pastMatch, saveBtn

### Community 10 - "Predictions Tab Component"
Cohesion: 0.2
Nodes (6): PredictionMap, PredictionsTabProps, makeMatch(), matches, select, twoRoundMatches()

### Community 11 - "Group Card (legacy)"
Cohesion: 0.2
Nodes (6): GroupCardProps, GroupWithStats, baseGroup, onClick, DashboardPageProps, User

### Community 12 - "Group Card Component"
Cohesion: 0.18
Nodes (4): GroupCardProps, GroupWithStats, baseGroup, onClick

### Community 13 - "Fixture Sync (API Football)"
Cohesion: 0.24
Nodes (9): ApiCompetition, ApiMatch, ApiMatchesResponse, ApiTeam, mapStatus(), slugify(), syncFixtures(), SyncOptions (+1 more)

### Community 14 - "Create Group Modal"
Cohesion: 0.2
Nodes (6): Competition, CreatedGroup, CreateGroupModalProps, competitions, createdGroup, defaultProps

### Community 15 - "Button & Header (legacy)"
Cohesion: 0.22
Nodes (4): ButtonProps, onClick, HeaderProps, User

### Community 16 - "Join Group Modal"
Cohesion: 0.22
Nodes (6): JoinedGroup, JoinGroupModalProps, body, defaultProps, fetchSpy, joinedGroup

### Community 17 - "Header Tests (legacy)"
Cohesion: 0.25
Nodes (6): baseUser, link, onCreateGroup, onJoinGroup, onLogout, sairBtn

### Community 18 - "Group Detail Page Tests (legacy)"
Cohesion: 0.29
Nodes (4): baseGroup, baseUser, fetchSpy, spy

### Community 19 - "Group Detail Page (legacy)"
Cohesion: 0.33
Nodes (4): GroupDetail, GroupDetailPageProps, Tab, User

### Community 21 - "Card (legacy)"
Cohesion: 0.33
Nodes (3): CardProps, { container }, div

### Community 22 - "Card Component"
Cohesion: 0.33
Nodes (3): CardProps, { container }, div

### Community 24 - "Team Badge Component"
Cohesion: 0.33
Nodes (3): TeamBadgeProps, { container }, img

### Community 25 - "Dashboard Page Tests (legacy)"
Cohesion: 0.4
Nodes (3): dialog, fetchSpy, user

### Community 28 - "Brand SVG Assets"
Cohesion: 0.67
Nodes (3): Logo 2 SVG, Logo SVG (Logo.svg), Logo Text SVG

## Knowledge Gaps
- **234 isolated node(s):** `Env`, `Variables`, `app`, `ALGORITHM`, `JwtPayload` (+229 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `config` connect `App Entry & Login` to `Predictions Tab (legacy)`, `Group Card (legacy)`, `Create Group Modal`, `Join Group Modal`, `Group Detail Page (legacy)`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `AppContext` connect `API Routers & Auth Middleware` to `Auth Encoding & Google OAuth`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **What connects `Env`, `Variables`, `app` to the rest of the system?**
  _234 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bracket UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `API Routers & Auth Middleware` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Auth Encoding & Google OAuth` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Architecture Decision Records` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._