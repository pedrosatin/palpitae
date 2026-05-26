# Graph Report - palpitae  (2026-05-26)

## Corpus Check
- 60 files · ~22,121 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 416 nodes · 544 edges · 37 communities (31 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `959cc524`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]

## God Nodes (most connected - your core abstractions)
1. `🧠 Palpitae — Product Vision` - 23 edges
2. `🤖 AGENTS.md — Palpitae` - 16 edges
3. `AppContext` - 11 edges
4. `signJwt()` - 11 edges
5. `Entities` - 11 edges
6. `Palpitae — Grupos Privados de Previsão de Futebol` - 10 edges
7. `config` - 9 edges
8. `base64UrlEncode()` - 8 edges
9. `Runtime Context` - 8 edges
10. `Architecture Decision Records` - 7 edges

## Surprising Connections (you probably didn't know these)
- `request()` --calls--> `signJwt()`  [EXTRACTED]
  api/src/groups/router.test.ts → api/src/auth/jwt.ts
- `requestGroupsList()` --calls--> `signJwt()`  [EXTRACTED]
  api/src/groups/router.test.ts → api/src/auth/jwt.ts
- `base64UrlEncode()` --calls--> `signJwt()`  [EXTRACTED]
  api/src/auth/encoding.ts → api/src/auth/jwt.ts
- `base64UrlEncode()` --calls--> `generateState()`  [EXTRACTED]
  api/src/auth/encoding.ts → api/src/auth/google.ts
- `base64UrlEncode()` --calls--> `generateNonce()`  [EXTRACTED]
  api/src/auth/encoding.ts → api/src/auth/google.ts

## Communities (37 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (45): base64UrlDecode(), base64UrlEncode(), buf, decoded, encoded, original, result, buildAuthUrl() (+37 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (36): 🔐 Authentication, Backend (API), Competition, 📏 Constraints, 🧱 Core Product Concept, 🧠 Design Principles, ⚽ Domain Model, Excluded (future): (+28 more)

### Community 2 - "Community 2"
Cohesion: 0.1
Nodes (23): requireAuth, app, fakeEnv(), requestWithCookie(), router, competition, competitionId, params (+15 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (28): App Root Component, Cloudflare D1, Cloudflare Workers, Frontend Config, Runtime Context, Architecture Decision Records, Base64URL Encoding Utils, Google Login Button (+20 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (29): ADR-001: Database Platform — Cloudflare D1, ADR-002: Migration Strategy — Wrangler D1 Migrations, ADR-003: API Runtime — Cloudflare Workers + Hono, ADR-004: Prediction Locking — Derived at Runtime, ADR-005: Authentication — Direct Google OAuth 2.0, ADR-006: Frontend Stack — Vite + React (Static Site), Architecture Decision Records, Consequences (+21 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (20): FEATURE_ALLOWLISTS, FEATURE_KEYS, FeatureFlags, FeatureKey, getFeatureFlags(), hasFeatureAccess(), body, candidate (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (17): code:mermaid (erDiagram), code:sql (PRAGMA foreign_keys = ON;), `competitions`, Database Schema — Palpitae, Entities, Entity Relationship Diagram, `group_members`, `groups` (+9 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (17): ✅ Alta Confiança, Anti-Abuse Strategy (MVP), ⚠️ Corrigido, ✅ In Scope, Key Assumptions to Validate, MVP Scope, Next Steps, Not Doing (and Why) (+9 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (16): 🤖 AGENTS.md — Palpitae, ⚠️ Anti-Patterns (Avoid), 🏗️ Architecture Guidelines, 🧩 Code Guidelines, 🗄️ Database Rules, ⚽ Domain Rules (Critical), 🧠 General Principles, 🎯 Goal (+8 more)

### Community 9 - "Community 9"
Cohesion: 0.53
Nodes (12): Competitions Table, Group Members Table, Groups Table, Leaderboard Table, Matches Table, Payments Table, Predictions Table, Profiles Table (+4 more)

### Community 10 - "Community 10"
Cohesion: 0.2
Nodes (6): GroupCardProps, GroupWithStats, baseGroup, onClick, DashboardPageProps, User

### Community 11 - "Community 11"
Cohesion: 0.24
Nodes (7): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, PredictionMap, PredictionsTabProps

### Community 12 - "Community 12"
Cohesion: 0.24
Nodes (9): ApiCompetition, ApiMatch, ApiMatchesResponse, ApiTeam, mapStatus(), slugify(), syncFixtures(), SyncOptions (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.24
Nodes (3): JoinedGroup, JoinGroupModalProps, config

### Community 14 - "Community 14"
Cohesion: 0.2
Nodes (6): HeaderProps, User, GroupDetail, GroupDetailPageProps, Tab, User

### Community 15 - "Community 15"
Cohesion: 0.2
Nodes (5): ButtonProps, onClick, Competition, CreatedGroup, CreateGroupModalProps

### Community 16 - "Community 16"
Cohesion: 0.2
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 17 - "Community 17"
Cohesion: 0.22
Nodes (4): AuthStatus, User, View, rootEl

### Community 18 - "Community 18"
Cohesion: 0.22
Nodes (9): API — Setup local, code:bash (cd api), code:bash (# Start local dev server (http://localhost:8787)), code:bash (# Set production secrets (one-time, stored encrypted in Clou), Deploying, First-time setup, Palpitae, Prerequisites (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.25
Nodes (6): baseUser, link, onCreateGroup, onJoinGroup, onLogout, sairBtn

### Community 20 - "Community 20"
Cohesion: 0.48
Nodes (6): body, createDbMock(), createGroupsListDbMock(), fakeEnv(), request(), requestGroupsList()

### Community 21 - "Community 21"
Cohesion: 0.33
Nodes (3): CardProps, { container }, div

### Community 23 - "Community 23"
Cohesion: 0.4
Nodes (4): body, defaultProps, fetchSpy, joinedGroup

### Community 24 - "Community 24"
Cohesion: 0.4
Nodes (3): competitions, createdGroup, defaultProps

### Community 25 - "Community 25"
Cohesion: 0.4
Nodes (3): dialog, fetchSpy, user

### Community 26 - "Community 26"
Cohesion: 0.5
Nodes (3): Overview, System Architecture — Palpitae, Working with Architecture

## Knowledge Gaps
- **226 isolated node(s):** `Env`, `Variables`, `app`, `ALGORITHM`, `JwtPayload` (+221 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `🤖 AGENTS.md — Palpitae` connect `Community 8` to `Community 3`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `AppContext` connect `Community 2` to `Community 0`, `Community 20`, `Community 5`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `Env`, `Variables`, `app` to the rest of the system?**
  _226 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._