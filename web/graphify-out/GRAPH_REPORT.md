# Graph Report - web  (2026-06-18)

## Corpus Check
- 80 files · ~29,476 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 283 nodes · 395 edges · 22 communities (20 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fe32420e`
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

## God Nodes (most connected - your core abstractions)
1. `config` - 14 edges
2. `SlotData` - 8 edges
3. `Round` - 7 edges
4. `Team` - 7 edges
5. `fetchCachedJson()` - 7 edges
6. `getAvailableTeams()` - 6 edges
7. `AvailableTeamsResult` - 6 edges
8. `Pick` - 5 edges
9. `BracketData` - 5 edges
10. `invalidateApiCache()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `fetchCachedJson()` --calls--> `loader`  [INFERRED]
  src/lib/api-cache.ts → src/lib/api-cache.test.ts
- `BracketTab()` --calls--> `buildMyPicksMap()`  [EXTRACTED]
  src/components/BracketTab/BracketTab.tsx → src/components/BracketTab/bracketLogic.ts
- `BracketTab()` --calls--> `getAvailableTeams()`  [EXTRACTED]
  src/components/BracketTab/BracketTab.tsx → src/components/BracketTab/bracketLogic.ts

## Communities (22 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (27): BracketColumnProps, ROUND_INDEX, BracketSlotCardProps, cascadeAvailable, { container }, memberPick, mp, onPick (+19 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (18): makeMatch(), GroupMember, GroupPicksResponse, GroupPicksTabProps, MemberPrediction, GroupPicksResponse, matches, applyDefaultRound() (+10 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (16): Competition, CreatedGroup, CreateGroupModalProps, dialog, fetchSpy, user, JoinedGroup, JoinGroupModalProps (+8 more)

### Community 3 - "Community 3"
Cohesion: 0.1
Nodes (14): DashboardPageProps, User, GroupDetail, GroupDetailPage(), GroupDetailPageProps, parseTab(), Tab, TABS (+6 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (14): allTeams, base, final, flipped, kept, map, picks, result (+6 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (4): GroupCardProps, GroupWithStats, baseGroup, onClick

### Community 6 - "Community 6"
Cohesion: 0.16
Nodes (10): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, awayInput, homeInput, input (+2 more)

### Community 7 - "Community 7"
Cohesion: 0.15
Nodes (7): TeamPickerProps, argBtn, available, buttons, onPick, teamsA, teamsB

### Community 8 - "Community 8"
Cohesion: 0.15
Nodes (8): HeaderProps, baseUser, link, onCreateGroup, onJoinGroup, onLogout, sairBtn, User

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (3): AuthStatus, User, rootEl

### Community 10 - "Community 10"
Cohesion: 0.2
Nodes (6): baseGroup, baseUser, confirmSpy, fetchSpy, spy, tabs

### Community 11 - "Community 11"
Cohesion: 0.33
Nodes (3): column, { container }, slots

### Community 12 - "Community 12"
Cohesion: 0.33
Nodes (3): TeamBadgeProps, { container }, img

### Community 13 - "Community 13"
Cohesion: 0.33
Nodes (3): CardProps, { container }, div

### Community 16 - "Community 16"
Cohesion: 0.4
Nodes (3): competitions, createdGroup, defaultProps

### Community 17 - "Community 17"
Cohesion: 0.4
Nodes (4): body, defaultProps, fetchSpy, joinedGroup

## Knowledge Gaps
- **114 isolated node(s):** `User`, `AuthStatus`, `rootEl`, `BracketTabProps`, `rounds` (+109 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `config` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 6`, `Community 9`?**
  _High betweenness centrality (0.207) - this node is a cross-community bridge._
- **Why does `SlotData` connect `Community 0` to `Community 11`, `Community 4`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Why does `Round` connect `Community 0` to `Community 4`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `User`, `AuthStatus`, `rootEl` to the rest of the system?**
  _114 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._