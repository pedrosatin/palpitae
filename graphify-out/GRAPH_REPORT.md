# Graph Report - .  (2026-05-09)

## Corpus Check
- Corpus is ~11,756 words - fits in a single context window. You may not need a graph.

## Summary
- 114 nodes · 180 edges · 15 communities (10 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]

## God Nodes (most connected - your core abstractions)
1. `base64UrlEncode()` - 7 edges
2. `base64UrlDecode()` - 5 edges
3. `signJwt()` - 5 edges
4. `verifyJwt()` - 5 edges
5. `AppContext` - 4 edges
6. `generateState()` - 4 edges
7. `generateNonce()` - 4 edges
8. `generatePkce()` - 4 edges
9. `importKey()` - 3 edges
10. `buildAuthUrl()` - 3 edges

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
- **Auth Module** —  [INFERRED]
- **Web Frontend** —  [INFERRED]
- **Database Schema** —  [INFERRED]

## Communities (15 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.0
Nodes (17): requireAuth, authRouter, clearOpts, { code, state, error }, codeVerifier, nonce, state, storedNonce (+9 more)

### Community 1 - "Community 1"
Cohesion: 0.0
Nodes (22): AGENTS.md, CLAUDE.md, Cloudflare D1, Cloudflare Workers, Runtime Context, Architecture Decision Records, Base64URL Encoding Utils, Google OAuth 2.0 (+14 more)

### Community 2 - "Community 2"
Cohesion: 0.0
Nodes (15): base64UrlDecode(), base64UrlEncode(), buildAuthUrl(), exchangeCode(), generateNonce(), generatePkce(), generateState(), GoogleIdTokenClaims (+7 more)

### Community 3 - "Community 3"
Cohesion: 0.0
Nodes (4): AuthStatus, User, config, rootEl

### Community 4 - "Community 4"
Cohesion: 0.0
Nodes (12): Competitions Table, Group Members Table, Groups Table, Leaderboard Table, Matches Table, Payments Table, Predictions Table, Profiles Table (+4 more)

### Community 5 - "Community 5"
Cohesion: 0.0
Nodes (9): ALGORITHM, importKey(), JwtPayload, signJwt(), [, body], [h, , s], payload, tamperedBody (+1 more)

### Community 6 - "Community 6"
Cohesion: 0.0
Nodes (8): App Root Component, Frontend Config, Google Login Button, HTML Entry Point, Login Page, Logo Text SVG, Frontend Entry Point, Logo (public)

## Knowledge Gaps
- **29 isolated node(s):** `Env`, `Variables`, `app`, `ALGORITHM`, `JwtPayload` (+24 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.