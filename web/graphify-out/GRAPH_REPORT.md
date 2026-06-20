# Graph Report - web  (2026-06-20)

## Corpus Check
- 92 files · ~40,830 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 339 nodes · 518 edges · 22 communities (19 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `13e0fc55`
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
1. `trackEvent()` - 16 edges
2. `config` - 15 edges
3. `SlotData` - 8 edges
4. `Round` - 7 edges
5. `Team` - 7 edges
6. `fetchCachedJson()` - 7 edges
7. `useDocumentTitle()` - 7 edges
8. `getAvailableTeams()` - 6 edges
9. `AvailableTeamsResult` - 6 edges
10. `Pick` - 5 edges

## Surprising Connections (you probably didn't know these)
- `GroupDetailPage()` --calls--> `useConfirm()`  [INFERRED]
  src/pages/GroupDetailPage/GroupDetailPage.tsx → src/components/ConfirmModal/useConfirm.tsx
- `fetchCachedJson()` --calls--> `loader`  [INFERRED]
  src/lib/api-cache.ts → src/lib/api-cache.test.ts
- `MembersTab()` --calls--> `useConfirm()`  [INFERRED]
  src/components/MembersTab/MembersTab.tsx → src/components/ConfirmModal/useConfirm.tsx
- `DashboardPage()` --calls--> `useDocumentTitle()`  [EXTRACTED]
  src/pages/DashboardPage/DashboardPage.tsx → src/hooks/useDocumentTitle.ts
- `LoginPage()` --calls--> `useDocumentTitle()`  [EXTRACTED]
  src/pages/LoginPage/LoginPage.tsx → src/hooks/useDocumentTitle.ts

## Communities (22 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (46): BracketColumnProps, ROUND_INDEX, column, { container }, slots, BracketSlotCardProps, cascadeAvailable, { container } (+38 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (18): DashboardPage(), DashboardPageProps, User, GroupDetail, GroupDetailPage(), GroupDetailPageProps, parseTab(), Tab (+10 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (16): ConfirmOptions, useConfirm(), dialog, fetchSpy, mockTrackEvent, user, Member, MembersTab() (+8 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (16): makeMatch(), GroupMember, GroupPicksResponse, GroupPicksTabProps, MemberPrediction, GroupPicksResponse, matches, { matches, picks } (+8 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (14): trackEvent(), ConfirmModalProps, Competition, CreatedGroup, CreateGroupModalProps, HeaderProps, User, JoinedGroup (+6 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (16): Consent, getStoredConsent(), initGa(), setConsent(), Window, mockGetStoredConsent, mockSetConsent, competitions (+8 more)

### Community 6 - "Community 6"
Cohesion: 0.14
Nodes (12): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, awayInput, homeInput, input (+4 more)

### Community 7 - "Community 7"
Cohesion: 0.18
Nodes (7): computeStandings(), StandingsTab(), StandingsTabProps, TeamStanding, matches, mockTrackEvent, standings

### Community 8 - "Community 8"
Cohesion: 0.17
Nodes (8): baseGroup, baseUser, confirmSpy, fetchSpy, input, mockTrackEvent, spy, tabs

### Community 10 - "Community 10"
Cohesion: 0.22
Nodes (6): argBtn, available, buttons, onPick, teamsA, teamsB

### Community 11 - "Community 11"
Cohesion: 0.22
Nodes (7): baseUser, link, mockTrackEvent, onCreateGroup, onJoinGroup, onLogout, sairBtn

### Community 12 - "Community 12"
Cohesion: 0.25
Nodes (4): GroupCardProps, GroupWithStats, baseGroup, onClick

### Community 13 - "Community 13"
Cohesion: 0.33
Nodes (3): TeamBadgeProps, { container }, img

### Community 14 - "Community 14"
Cohesion: 0.33
Nodes (3): CardProps, { container }, div

### Community 15 - "Community 15"
Cohesion: 0.33
Nodes (5): body, defaultProps, fetchSpy, joinedGroup, mockTrackEvent

## Knowledge Gaps
- **143 isolated node(s):** `DashboardPage`, `GroupDetailPage`, `User`, `AuthStatus`, `rootEl` (+138 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `trackEvent()` connect `Community 4` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 7`, `Community 9`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `config` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **What connects `DashboardPage`, `GroupDetailPage`, `User` to the rest of the system?**
  _143 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._