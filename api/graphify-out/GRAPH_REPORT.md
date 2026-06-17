# Graph Report - api  (2026-06-16)

## Corpus Check
- 35 files · ~18,234 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 243 nodes · 366 edges · 11 communities (10 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1a14f24c`
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

## God Nodes (most connected - your core abstractions)
1. `signJwt()` - 15 edges
2. `AppContext` - 14 edges
3. `base64UrlEncode()` - 8 edges
4. `scoreUnprocessedMatches()` - 8 edges
5. `syncFixtures()` - 8 edges
6. `requireAuth` - 7 edges
7. `base64UrlDecode()` - 6 edges
8. `pollActiveMatches()` - 6 edges
9. `logRequestPerf()` - 5 edges
10. `verifyJwt()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `scheduled()` --calls--> `pollActiveMatches()`  [EXTRACTED]
  src/index.ts → src/matches/poller.ts
- `signJwt()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  src/auth/jwt.ts → src/auth/encoding.ts
- `requestWithCookie()` --calls--> `signJwt()`  [EXTRACTED]
  src/auth/router.test.ts → src/auth/jwt.ts
- `requestRemoveMember()` --calls--> `signJwt()`  [EXTRACTED]
  src/groups/router.test.ts → src/auth/jwt.ts
- `pollActiveMatches()` --calls--> `scoreUnprocessedMatches()`  [EXTRACTED]
  src/matches/poller.ts → src/matches/scoring.ts

## Communities (11 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (39): ActiveRound, ActiveRow, db, [earliestOver, stillRelevant], matchdays, scoreMock, syncFixturesMock, competitionId (+31 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (31): byMatch, groupId, importStatements, locked, match, matchId, matchIds, matchRows (+23 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (27): FEATURE_ALLOWLISTS, FEATURE_KEYS, FeatureFlags, FeatureKey, getFeatureFlags(), hasFeatureAccess(), body, candidate (+19 more)

### Community 3 - "Community 3"
Cohesion: 0.1
Nodes (26): base64UrlEncode(), buildAuthUrl(), exchangeCode(), generateNonce(), generatePkce(), generateState(), GoogleIdTokenClaims, GoogleUserInfo (+18 more)

### Community 4 - "Community 4"
Cohesion: 0.1
Nodes (19): base64UrlDecode(), buf, decoded, encoded, original, result, verifyGoogleIdToken(), ALGORITHM (+11 more)

### Community 5 - "Community 5"
Cohesion: 0.11
Nodes (21): signJwt(), body, createDbMock(), createGroupsListDbMock(), { db }, { db, deleteRun }, fakeEnv(), request() (+13 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (20): allPicksResult, byPos, competitionId, groupId, KNOCKOUT_PHASES, KnockoutPhase, matchesResult, matchForSlot (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.15
Nodes (13): authRouter, fakeEnv(), requestWithCookie(), router, pollActiveMatches(), app, { syncFixturesSpy }, waitUntil (+5 more)

### Community 8 - "Community 8"
Cohesion: 0.47
Nodes (4): env, fetchMatches(), main(), summarizeMatches()

## Knowledge Gaps
- **153 isolated node(s):** `RequestPerfMetrics`, `Variables`, `PackageJson`, `app`, `ALGORITHM` (+148 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppContext` connect `Community 7` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`?**
  _High betweenness centrality (0.130) - this node is a cross-community bridge._
- **Why does `requireAuth` connect `Community 4` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 6`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `scoreUnprocessedMatches()` connect `Community 0` to `Community 7`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **What connects `RequestPerfMetrics`, `Variables`, `PackageJson` to the rest of the system?**
  _153 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._