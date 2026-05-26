# Graph Report - .  (2026-05-26)

## Corpus Check
- Corpus is ~24,416 words - fits in a single context window. You may not need a graph.

## Summary
- 288 nodes · 429 edges · 20 communities (17 shown, 3 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

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
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]

## God Nodes (most connected - your core abstractions)
1. `AppContext` - 11 edges
2. `signJwt()` - 11 edges
3. `config` - 9 edges
4. `base64UrlEncode()` - 8 edges
5. `base64UrlDecode()` - 6 edges
6. `requireAuth` - 6 edges
7. `verifyJwt()` - 5 edges
8. `generateState()` - 4 edges
9. `generateNonce()` - 4 edges
10. `generatePkce()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `signJwt()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/auth/jwt.ts → api/src/auth/encoding.ts
- `verifyJwt()` --calls--> `base64UrlDecode()`  [EXTRACTED]
  api/src/auth/jwt.ts → api/src/auth/encoding.ts
- `generateState()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/auth/google.ts → api/src/auth/encoding.ts
- `generateNonce()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/auth/google.ts → api/src/auth/encoding.ts
- `generatePkce()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/auth/google.ts → api/src/auth/encoding.ts

## Hyperedges (group relationships)
- **Source of Truth Priority Order** —  [EXTRACTED]
- **Cloudflare Infrastructure Stack** —  [EXTRACTED]
- **Modular Monolith Domain Boundaries** —  [EXTRACTED]
- **Brand Visual Assets** —  [INFERRED]

## Communities (20 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.0
Nodes (29): CardProps, { container }, div, Competition, CreatedGroup, CreateGroupModalProps, competitions, createdGroup (+21 more)

### Community 1 - "Community 1"
Cohesion: 0.0
Nodes (33): base64UrlDecode(), base64UrlEncode(), buf, decoded, encoded, original, result, buildAuthUrl() (+25 more)

### Community 2 - "Community 2"
Cohesion: 0.0
Nodes (36): AGENTS.md, API Football (External Provider), CLAUDE.md, Cloudflare D1 (SQLite), Cloudflare Pages, Cloudflare Workers, Runtime Context, Architecture Decision Records (+28 more)

### Community 3 - "Community 3"
Cohesion: 0.0
Nodes (24): requireAuth, app, fakeEnv(), requestWithCookie(), authRouter, router, competition, competitionId (+16 more)

### Community 4 - "Community 4"
Cohesion: 0.0
Nodes (14): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, input, pastMatch, saveBtn (+6 more)

### Community 5 - "Community 5"
Cohesion: 0.0
Nodes (20): FEATURE_ALLOWLISTS, FEATURE_KEYS, FeatureFlags, FeatureKey, getFeatureFlags(), hasFeatureAccess(), body, candidate (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.0
Nodes (17): ALGORITHM, importKey(), JwtPayload, signJwt(), [, body], [h, , s], payload, tamperedBody (+9 more)

### Community 7 - "Community 7"
Cohesion: 0.0
Nodes (10): ButtonProps, onClick, HeaderProps, baseUser, link, onCreateGroup, onJoinGroup, onLogout (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.0
Nodes (9): ApiCompetition, ApiMatch, ApiMatchesResponse, ApiTeam, mapStatus(), slugify(), syncFixtures(), SyncOptions (+1 more)

### Community 9 - "Community 9"
Cohesion: 0.0
Nodes (4): baseGroup, baseUser, fetchSpy, spy

### Community 11 - "Community 11"
Cohesion: 0.0
Nodes (3): dialog, fetchSpy, user

### Community 12 - "Community 12"
Cohesion: 0.0
Nodes (3): Logo 2 SVG, Logo SVG (Logo.svg), Logo Text SVG

## Knowledge Gaps
- **126 isolated node(s):** `Env`, `Variables`, `app`, `ALGORITHM`, `JwtPayload` (+121 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.