# Graph Report - api  (2026-06-21)

## Corpus Check
- 38 files · ~19,943 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 274 nodes · 416 edges · 12 communities (11 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `441cc67a`
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

## God Nodes (most connected - your core abstractions)
1. `signJwt()` - 16 edges
2. `AppContext` - 14 edges
3. `base64UrlEncode()` - 8 edges
4. `scoreUnprocessedMatches()` - 8 edges
5. `syncFixtures()` - 8 edges
6. `requireAuth` - 7 edges
7. `pollActiveMatches()` - 7 edges
8. `base64UrlDecode()` - 6 edges
9. `verifyJwt()` - 5 edges
10. `fakeEnv()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `scheduled()` --calls--> `pollActiveMatches()`  [EXTRACTED]
  src/index.ts → src/matches/poller.ts
- `signJwt()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  src/auth/jwt.ts → src/auth/encoding.ts
- `verifyJwt()` --calls--> `base64UrlDecode()`  [EXTRACTED]
  src/auth/jwt.ts → src/auth/encoding.ts
- `requestWithCookie()` --calls--> `signJwt()`  [EXTRACTED]
  src/auth/router.test.ts → src/auth/jwt.ts
- `requestRemoveMember()` --calls--> `signJwt()`  [EXTRACTED]
  src/groups/router.test.ts → src/auth/jwt.ts

## Communities (12 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (35): ActiveRound, pollActiveMatches(), ActiveRow, db, [earliestOver, stillRelevant], matchdays, scoreMock, syncFixturesMock (+27 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (34): base64UrlDecode(), base64UrlEncode(), buf, decoded, encoded, original, result, buildAuthUrl() (+26 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (31): ALGORITHM, importKey(), JwtPayload, signJwt(), [, body], [h, , s], payload, tamperedBody (+23 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (27): FEATURE_ALLOWLISTS, FEATURE_KEYS, FeatureFlags, FeatureKey, getFeatureFlags(), hasFeatureAccess(), body, candidate (+19 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (28): byMatch, groupId, importStatements, locked, match, matchId, matchIds, matchRows (+20 more)

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (15): requireAuth, app, fakeEnv(), requestWithCookie(), fakeEnv(), requestWithCookie(), router, dayBounds() (+7 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (20): allPicksResult, byPos, competitionId, groupId, KNOCKOUT_PHASES, KnockoutPhase, matchesResult, matchForSlot (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (17): cacheKey, competitionId, dbStartedAt, nowIso, params, response, round, router (+9 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (11): app, cacheHeaderFor(), counter, createMatchesDbMock(), env, fakeEnv(), first, second (+3 more)

### Community 9 - "Community 9"
Cohesion: 0.47
Nodes (4): env, fetchMatches(), main(), summarizeMatches()

## Knowledge Gaps
- **166 isolated node(s):** `PackageJson`, `app`, `Variables`, `ALGORITHM`, `JwtPayload` (+161 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppContext` connect `Community 5` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 6`, `Community 7`, `Community 8`?**
  _High betweenness centrality (0.132) - this node is a cross-community bridge._
- **Why does `scoreUnprocessedMatches()` connect `Community 0` to `Community 7`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `signJwt()` connect `Community 2` to `Community 1`, `Community 5`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **What connects `PackageJson`, `app`, `Variables` to the rest of the system?**
  _166 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._