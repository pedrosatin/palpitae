# Graph Report - .  (2026-07-05)

## Corpus Check
- 182 files · ~96,492 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 949 nodes · 1349 edges · 93 communities (73 shown, 20 thin omitted)
- Extraction: 95% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 57 edges (avg confidence: 0.79)
- Token cost: 551,539 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Notifications & Observability|Notifications & Observability]]
- [[_COMMUNITY_Architecture Decision Records|Architecture Decision Records]]
- [[_COMMUNITY_Penalties & Scoring API|Penalties & Scoring API]]
- [[_COMMUNITY_Rounds & Round Reminders|Rounds & Round Reminders]]
- [[_COMMUNITY_Feature Flags & Permissions|Feature Flags & Permissions]]
- [[_COMMUNITY_Groups Router|Groups Router]]
- [[_COMMUNITY_UI Primitives & API Cache|UI Primitives & API Cache]]
- [[_COMMUNITY_AuthGroups Router Tests|Auth/Groups Router Tests]]
- [[_COMMUNITY_Metrics Charts & Formatters|Metrics Charts & Formatters]]
- [[_COMMUNITY_Metrics Router|Metrics Router]]
- [[_COMMUNITY_Group Picks & Leaderboard|Group Picks & Leaderboard]]
- [[_COMMUNITY_GA4 Analytics & Consent|GA4 Analytics & Consent]]
- [[_COMMUNITY_Create Group Modal & Presets|Create Group Modal & Presets]]
- [[_COMMUNITY_Match Card|Match Card]]
- [[_COMMUNITY_Crypto & OAuth Helpers|Crypto & OAuth Helpers]]
- [[_COMMUNITY_API Cache Layer|API Cache Layer]]
- [[_COMMUNITY_Events Export to R2|Events Export to R2]]
- [[_COMMUNITY_Group Detail Page & Tabs|Group Detail Page & Tabs]]
- [[_COMMUNITY_Matches Router Tests|Matches Router Tests]]
- [[_COMMUNITY_Group Picks Fixtures|Group Picks Fixtures]]
- [[_COMMUNITY_Google OAuth|Google OAuth]]
- [[_COMMUNITY_Page Components & Titles|Page Components & Titles]]
- [[_COMMUNITY_Auth Router & Cookies|Auth Router & Cookies]]
- [[_COMMUNITY_Cookie Consent & GA Init|Cookie Consent & GA Init]]
- [[_COMMUNITY_Google Login Button|Google Login Button]]
- [[_COMMUNITY_Match Poller|Match Poller]]
- [[_COMMUNITY_JWT Middleware|JWT Middleware]]
- [[_COMMUNITY_Fixture Discovery & Polling|Fixture Discovery & Polling]]
- [[_COMMUNITY_Header Component|Header Component]]
- [[_COMMUNITY_Governance & Domain Rules|Governance & Domain Rules]]
- [[_COMMUNITY_HMAC Crypto & Tokens|HMAC Crypto & Tokens]]
- [[_COMMUNITY_Match Sync & API Mapping|Match Sync & API Mapping]]
- [[_COMMUNITY_Group Fetch Test Mocks|Group Fetch Test Mocks]]
- [[_COMMUNITY_Observability Events Core|Observability Events Core]]
- [[_COMMUNITY_Match Sync Tests|Match Sync Tests]]
- [[_COMMUNITY_Join Group Modal|Join Group Modal]]
- [[_COMMUNITY_Base64 Encoding|Base64 Encoding]]
- [[_COMMUNITY_Landing Page|Landing Page]]
- [[_COMMUNITY_Predictions & Standings Tabs|Predictions & Standings Tabs]]
- [[_COMMUNITY_Unsubscribe Router|Unsubscribe Router]]
- [[_COMMUNITY_Group Card|Group Card]]
- [[_COMMUNITY_App Routing|App Routing]]
- [[_COMMUNITY_Settings Page|Settings Page]]
- [[_COMMUNITY_Cookie Consent GA|Cookie Consent GA]]
- [[_COMMUNITY_Router Test Helpers|Router Test Helpers]]
- [[_COMMUNITY_Results API Script|Results API Script]]
- [[_COMMUNITY_Card Component|Card Component]]
- [[_COMMUNITY_Modal Component|Modal Component]]
- [[_COMMUNITY_Button Component|Button Component]]
- [[_COMMUNITY_Confirm Modal|Confirm Modal]]
- [[_COMMUNITY_Penalty Badge|Penalty Badge]]
- [[_COMMUNITY_Admin Metrics Charts|Admin Metrics Charts]]
- [[_COMMUNITY_Wrangler Config Test|Wrangler Config Test]]
- [[_COMMUNITY_Football-data Fetch|Football-data Fetch]]
- [[_COMMUNITY_Penalty Parsing|Penalty Parsing]]
- [[_COMMUNITY_SEO Assets|SEO Assets]]
- [[_COMMUNITY_Group Card Types|Group Card Types]]
- [[_COMMUNITY_Brand Logo SVGs|Brand Logo SVGs]]
- [[_COMMUNITY_Brand Logo Variants|Brand Logo Variants]]
- [[_COMMUNITY_App Icons & Social Card|App Icons & Social Card]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]

## God Nodes (most connected - your core abstractions)
1. `signJwt()` - 20 edges
2. `AppContext` - 17 edges
3. `trackEvent()` - 17 edges
4. `config` - 15 edges
5. `GroupDetailPage` - 15 edges
6. `sendRoundReminders()` - 13 edges
7. `base64UrlEncode()` - 11 edges
8. `syncFixtures()` - 11 edges
9. `useDocumentTitle()` - 11 edges
10. `matchesRouter` - 11 edges

## Surprising Connections (you probably didn't know these)
- `predictionsRouter` --semantically_similar_to--> `Penalty shootout bonus (points_penalty)`  [INFERRED] [semantically similar]
  api/src/predictions/router.ts → docs/group-scoring.md
- `App (root component)` --semantically_similar_to--> `ADR-006 Vite + React static site`  [INFERRED] [semantically similar]
  web/src/App.tsx → docs/architecture/decisions.md
- `GoogleLoginButton (barrel)` --references--> `trackEvent client analytics`  [AMBIGUOUS]
  web/src/components/GoogleLoginButton/index.ts → docs/analytics.md
- `predictionsRouter` --references--> `Positional event schema`  [INFERRED]
  api/src/predictions/router.ts → docs/observability.md
- `web config / buildApiUrl` --references--> `trackEvent client analytics`  [INFERRED]
  web/src/config.ts → docs/analytics.md

## Hyperedges (group relationships)
- **Cron scheduled dispatch** — index_scheduled, export_exportrecentdays, fixturediscovery_discoverfixtures, roundreminder_sendroundreminders, poller_pollactivematches [EXTRACTED 1.00]
- **Knockout bracket & penalty scoring** — migration_bracket_picks, migration_penalty_picks, agents_scoring_rules [INFERRED 0.75]
- **Palpitae scoring model** — agents_scoring_rules, migration_group_scoring_config, migration_initial_schema, migration_penalty_picks [INFERRED 0.75]
- **** — router_auth_router, google_exchange_code, google_verify_google_id_token, google_upsert_user, jwt_sign_jwt [INFERRED 0.85]
- **** — poller_poll_active_matches, fixturediscovery_discover_fixtures, sync_sync_fixtures, scoring_score_unprocessed_matches [INFERRED 0.85]
- **** — roundreminder_sendroundreminders, roundreminder_sendwithretry, email_sendemail, roundreminder_buildemailhtml [INFERRED 0.85]
- **** — scoring_scoreunprocessedmatches, scoring_scorematch, scoring_calculatepoints, scoring_recalculateleaderboard [INFERRED 0.85]
- **** — events_logevent, export_exporteventstor2, metricsrouter_runaesql [INFERRED 0.80]
- **** — log_event, analytics_engine_hot_path, r2_cold_path, native_metrics_dashboard [INFERRED 0.85]
- **** — penalty_bonus, penalty_phases_gate, predictions_router, group_scoring_config [INFERRED 0.85]
- **** — adr_004_prediction_locking, predictions_router, product_vision [INFERRED 0.85]
- **Modal dialog family (shared Modal + Button composition)** — confirmmodal_confirmmodal, creategroupmodal_creategroupmodal, useconfirm_useconfirm [INFERRED 0.85]
- **GA analytics tracking flow (trackEvent instrumentation)** — ga_trackevent, creategroupmodal_creategroupmodal, googleloginbutton_googleloginbutton [EXTRACTED 1.00]
- **LGPD consent mode flow** — ga_getstoredconsent, ga_setconsent, cookieconsent_cookieconsent [EXTRACTED 1.00]
- **Group detail tab family (fetch + render group state)** —  [INFERRED 0.85]
- **Round navigation with prev/next/select and applyDefaultRound** —  [INFERRED 0.85]
- **Client-side analytics via trackEvent** —  [INFERRED 0.75]
- **** — predictionstab_component, standingstab_component, apicache_fetchcachedjson [INFERRED 0.85]
- **Authenticated app shell (Header + auth-gated pages)** —  [INFERRED 0.75]
- **Unauthenticated funnel to Google login** —  [INFERRED 0.75]

## Communities (93 total, 20 thin omitted)

### Community 0 - "Notifications & Observability"
Cohesion: 0.05
Nodes (52): EmailError, sendEmail, notifications/email.test, hashUserId, logEvent, observability/events.test, dayBounds, exportEventsToR2 (+44 more)

### Community 1 - "Architecture Decision Records"
Cohesion: 0.06
Nodes (41): ADR-001 Cloudflare D1, ADR-003 Workers + Hono, ADR-004 Runtime prediction locking, ADR-005 Direct Google OAuth, ADR-006 Vite + React static site, ADR-007 Cron result poller, ADR-008 GET /matches caching, ADR-009 Round reminder e-mail (Resend) (+33 more)

### Community 2 - "Penalties & Scoring API"
Cohesion: 0.07
Nodes (31): competitions, result, router, matchGoesToPenalties(), parsePenaltyPhases(), cacheKey, competitionId, dbStartedAt (+23 more)

### Community 3 - "Rounds & Round Reminders"
Cohesion: 0.08
Nodes (28): KNOCKOUT_LABELS, roundLabel(), EmailError, EmailMessage, sendEmail(), body, buildEmailHtml(), buildEmailText() (+20 more)

### Community 4 - "Feature Flags & Permissions"
Cohesion: 0.06
Nodes (32): FEATURE_KEYS, FeatureFlags, FeatureKey, getFeatureFlags(), hasFeatureAccess(), flags, flags1, flags2 (+24 more)

### Community 5 - "Groups Router"
Cohesion: 0.06
Nodes (33): byMatch, eligible, groupConfig, groupId, importStatements, info, invalidPenalty, locked (+25 more)

### Community 6 - "UI Primitives & API Cache"
Cohesion: 0.12
Nodes (20): fetchCachedJson, invalidateApiCache, Button, Button.test, Card, Card.test, buildApiUrl, ConfirmModal (+12 more)

### Community 7 - "Auth/Groups Router Tests"
Cohesion: 0.1
Nodes (23): signJwt(), body, createDbMock(), createGroupsListDbMock(), { db }, { db, deleteRun }, { db, updateRun }, fakeEnv() (+15 more)

### Community 8 - "Metrics Charts & Formatters"
Cohesion: 0.08
Nodes (18): ArchiveResponse, buildApiCallsSeries(), buildStackedSeries(), CRON_INFO, lastDays(), OverviewResponse, PERIODS, archive (+10 more)

### Community 9 - "Metrics Router"
Cohesion: 0.1
Nodes (16): fakeEnv(), requestWithCookie(), admin, days, files, metricsRouter, monthPrefixes, now (+8 more)

### Community 10 - "Group Picks & Leaderboard"
Cohesion: 0.1
Nodes (14): GroupMember, GroupPicksResponse, GroupPicksTabProps, MemberPrediction, LeaderboardTabProps, Member, members, mockTrackEvent (+6 more)

### Community 11 - "GA4 Analytics & Consent"
Cohesion: 0.11
Nodes (23): Analytics (GA4 click events), Pages API proxy onRequest, applyDefaultRound, BallIcon, click_<context>_<acao> naming, fetchCachedJson, GA4 Consent Mode v2, GoogleLoginButton (barrel) (+15 more)

### Community 12 - "Create Group Modal & Presets"
Cohesion: 0.08
Nodes (17): Competition, CreatedGroup, CreateGroupModalProps, PRESET_LABELS, PRESET_VALUES, SCORING_HELP_TEXT, ScoringPreset, body (+9 more)

### Community 13 - "Match Card"
Cohesion: 0.11
Nodes (18): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, awayInput, body, chip (+10 more)

### Community 14 - "Crypto & OAuth Helpers"
Cohesion: 0.14
Nodes (22): importHmacKey, base64UrlDecode, base64UrlEncode, discoverFixtures, buildAuthUrl, exchangeCode, generatePkce, upsertUser (+14 more)

### Community 15 - "API Cache Layer"
Cohesion: 0.12
Nodes (12): CacheEntry, fetchCachedJson(), invalidateApiCache(), responseCache, loader, computeStandings(), StandingsTab(), StandingsTabProps (+4 more)

### Community 16 - "Events Export to R2"
Cohesion: 0.16
Nodes (13): dayBounds(), exportEventsToR2(), exportRecentDays(), dd, env, events, FetchFake, { from, to, key } (+5 more)

### Community 17 - "Group Detail Page & Tabs"
Cohesion: 0.12
Nodes (14): useConfirm(), GroupDetail, GroupDetailPage(), GroupDetailPageProps, parseTab(), Tab, TAB_LABELS, TABS (+6 more)

### Community 18 - "Matches Router Tests"
Cohesion: 0.12
Nodes (13): app, body, cacheHeaderFor(), counter, createMatchesDbMock(), env, fakeEnv(), first (+5 more)

### Community 19 - "Group Picks Fixtures"
Cohesion: 0.12
Nodes (10): makeMatch(), GroupPicksResponse, li, matches, { matches, picks }, mockTrackEvent, matches, mockTrackEvent (+2 more)

### Community 20 - "Google OAuth"
Cohesion: 0.18
Nodes (14): base64UrlEncode(), buildAuthUrl(), exchangeCode(), generateNonce(), generatePkce(), generateState(), GoogleIdTokenClaims, GoogleUserInfo (+6 more)

### Community 21 - "Page Components & Titles"
Cohesion: 0.18
Nodes (11): AdminMetricsPage(), trackEvent(), DashboardPage(), DashboardPageProps, User, useDocumentTitle(), LoginPage(), mockTrackEvent (+3 more)

### Community 22 - "Auth Router & Cookies"
Cohesion: 0.13
Nodes (15): authRouter, clearOpts, { code, state, error }, codeVerifier, cookieDomain(), cookieOptions(), KNOWN_OAUTH_ERRORS, nonce (+7 more)

### Community 23 - "Cookie Consent & GA Init"
Cohesion: 0.19
Nodes (9): Consent, getStoredConsent(), initGa(), setConsent(), setItemMock, Window, mockGetStoredConsent, mockSetConsent (+1 more)

### Community 24 - "Google Login Button"
Cohesion: 0.16
Nodes (8): dialog, fetchSpy, mockTrackEvent, user, mockTrackEvent, buildApiUrl(), config, isAbsoluteUrl()

### Community 25 - "Match Poller"
Cohesion: 0.14
Nodes (10): ActiveRow, ae, db, [earliestOver, stillRelevant], errors, matchdays, runs, scoreMock (+2 more)

### Community 26 - "JWT Middleware"
Cohesion: 0.17
Nodes (9): [, body], [h, , s], payload, tamperedBody, verifyJwt(), requireAuth, app, fakeEnv() (+1 more)

### Community 27 - "Fixture Discovery & Polling"
Cohesion: 0.35
Nodes (10): ActiveCompetition, discoverFixtures(), ActiveRound, pollActiveMatches(), maybeSyncResults(), scoreUnprocessedMatches(), syncFixtures(), logEvent() (+2 more)

### Community 28 - "Header Component"
Cohesion: 0.15
Nodes (9): HeaderProps, baseUser, link, mockTrackEvent, onCreateGroup, onJoinGroup, onLogout, sairBtn (+1 more)

### Community 29 - "Governance & Domain Rules"
Cohesion: 0.17
Nodes (13): Click Analytics (trackEvent), AGENTS.md Governance & Intent, Server-side Observability (logEvent), Prediction Locking (before match start), Ranking Tie-breakers, Scoring Rules (exact=3, outcome=1), CLAUDE.md Project Instructions, 0003 bracket picks (+5 more)

### Community 30 - "HMAC Crypto & Tokens"
Cohesion: 0.3
Nodes (7): HMAC_SHA256, importHmacKey(), JwtPayload, signUnsubToken(), forgedId, [, sig], verifyUnsubToken()

### Community 31 - "Match Sync & API Mapping"
Cohesion: 0.18
Nodes (10): ApiCompetition, ApiMatch, ApiMatchesResponse, ApiTeam, COMP_TRANSLATIONS, mapStatus(), slugify(), SyncOptions (+2 more)

### Community 32 - "Group Fetch Test Mocks"
Cohesion: 0.18
Nodes (7): baseGroup, baseUser, fetchSpy, input, mockTrackEvent, spy, tabs

### Community 33 - "Observability Events Core"
Cohesion: 0.22
Nodes (7): unsubscribeByToken(), EventDims, EventType, hashUserId(), { ae, calls }, long, Point

### Community 34 - "Match Sync Tests"
Cohesion: 0.22
Nodes (7): Captured, { db, captured }, { db, sqls }, m, match(), ScoreOverrides, team()

### Community 35 - "Join Group Modal"
Cohesion: 0.2
Nodes (7): JoinedGroup, JoinGroupModalProps, body, defaultProps, fetchSpy, joinedGroup, mockTrackEvent

### Community 36 - "Base64 Encoding"
Cohesion: 0.25
Nodes (7): base64UrlDecode(), buf, decoded, encoded, original, result, verifyGoogleIdToken()

### Community 38 - "Predictions & Standings Tabs"
Cohesion: 0.25
Nodes (9): fetchCachedJson, Modal, BallIcon, PenaltyBadge, PredictionsTab, applyDefaultRound, isGroupStageRound, StandingsTab (+1 more)

### Community 39 - "Unsubscribe Router"
Cohesion: 0.25
Nodes (5): body, router, row, token, userId

### Community 40 - "Group Card"
Cohesion: 0.25
Nodes (4): GroupCardProps, GroupWithStats, baseGroup, onClick

### Community 41 - "App Routing"
Cohesion: 0.25
Nodes (6): AdminMetricsPage, AuthStatus, DashboardPage, GroupDetailPage, SettingsPage, User

### Community 42 - "Settings Page"
Cohesion: 0.29
Nodes (4): fetchSpy, mockTrackEvent, patchCall, user

### Community 43 - "Cookie Consent GA"
Cohesion: 0.38
Nodes (7): CookieConsent, CookieConsent.test, gaEnabled, getStoredConsent, initGa, setConsent, ga.test

### Community 45 - "Results API Script"
Cohesion: 0.47
Nodes (4): env, fetchMatches(), main(), summarizeMatches()

### Community 46 - "Card Component"
Cohesion: 0.33
Nodes (3): CardProps, { container }, div

### Community 51 - "Admin Metrics Charts"
Cohesion: 0.67
Nodes (4): AdminMetricsPage, BarChart, StackedBarChart, useDocumentTitle

### Community 53 - "Football-data Fetch"
Cohesion: 0.67
Nodes (3): fetchMatches (football-data.org), test-results-api main, summarizeMatches

### Community 54 - "Penalty Parsing"
Cohesion: 0.67
Nodes (3): matchGoesToPenalties, parsePenaltyPhases, competitionsRouter

### Community 57 - "Brand Logo SVGs"
Cohesion: 1.0
Nodes (3): Palpitae Icon (green on black), Palpitae Icon (green on white), Palpitae Wordmark + Icon Logo

### Community 58 - "Brand Logo Variants"
Cohesion: 1.0
Nodes (3): Palpitae App Icon, Palpitae Logo (Black variant), Palpitae Logo (Green variant)

### Community 59 - "App Icons & Social Card"
Cohesion: 1.0
Nodes (3): Palpitae App Icon (Apple Touch Icon), Bracket View Screenshot (Chaveamento), Palpitae OG Social Share Card

## Ambiguous Edges - Review These
- `escapeHtml` → `verifyUnsubToken`  [AMBIGUOUS]
  api/src/notifications/roundReminder.ts · relation: semantically_similar_to
- `trackEvent client analytics` → `GoogleLoginButton (barrel)`  [AMBIGUOUS]
  web/src/components/GoogleLoginButton/index.ts · relation: references
- `ga.test` → `CookieConsent`  [AMBIGUOUS]
  web/src/components/CookieConsent/CookieConsent.tsx · relation: semantically_similar_to
- `PenaltyBadge` → `StandingsTab`  [AMBIGUOUS]
  web/src/components/StandingsTab/StandingsTab.tsx · relation: semantically_similar_to

## Knowledge Gaps
- **433 isolated node(s):** `PackageJson`, `env`, `ctx`, `app`, `Variables` (+428 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `escapeHtml` and `verifyUnsubToken`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `trackEvent client analytics` and `GoogleLoginButton (barrel)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `ga.test` and `CookieConsent`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `PenaltyBadge` and `StandingsTab`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **Why does `AppContext` connect `Metrics Router` to `Penalties & Scoring API`, `Feature Flags & Permissions`, `Groups Router`, `Auth/Groups Router Tests`, `Unsubscribe Router`, `Router Test Helpers`, `Matches Router Tests`, `Auth Router & Cookies`, `JWT Middleware`, `Fixture Discovery & Polling`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `trackEvent()` connect `Page Components & Titles` to `Join Group Modal`, `Landing Page`, `Metrics Charts & Formatters`, `Group Picks & Leaderboard`, `Create Group Modal & Presets`, `Match Card`, `API Cache Layer`, `Group Detail Page & Tabs`, `Cookie Consent & GA Init`, `Google Login Button`, `Header Component`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `signJwt()` connect `Auth/Groups Router Tests` to `Metrics Router`, `Router Test Helpers`, `Google OAuth`, `Auth Router & Cookies`, `JWT Middleware`, `HMAC Crypto & Tokens`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._