# Graph Report - palpitae  (2026-07-16)

## Corpus Check
- 210 files · ~176,170 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1662 nodes · 3426 edges · 132 communities (114 shown, 18 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 65 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5daa9ca7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 123|Community 123]]
- [[_COMMUNITY_Community 124|Community 124]]
- [[_COMMUNITY_Community 125|Community 125]]
- [[_COMMUNITY_Community 126|Community 126]]
- [[_COMMUNITY_Community 127|Community 127]]
- [[_COMMUNITY_Community 128|Community 128]]
- [[_COMMUNITY_Community 129|Community 129]]
- [[_COMMUNITY_Community 130|Community 130]]
- [[_COMMUNITY_Community 131|Community 131]]

## God Nodes (most connected - your core abstractions)
1. `trackEvent()` - 49 edges
2. `AppContext` - 38 edges
3. `config` - 37 edges
4. `apiFetch()` - 36 edges
5. `signJwt()` - 32 edges
6. `scoreUnprocessedMatches()` - 29 edges
7. `syncFixtures()` - 26 edges
8. `🧠 Palpitae — Product Vision` - 23 edges
9. `sendRoundReminders()` - 22 edges
10. `useDocumentTitle()` - 22 edges

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

## Communities (132 total, 18 thin omitted)

### Community 0 - "Notifications & Observability"
Cohesion: 0.05
Nodes (89): ActiveCompetition, ActiveCompetition, ae, buildFakeAe(), buildFakeDb(), db, errors, pointsOfType() (+81 more)

### Community 1 - "Architecture Decision Records"
Cohesion: 0.05
Nodes (83): signJwt(), [, body], [h, , s], payload, tamperedBody, app, buildApp(), fakeEnv() (+75 more)

### Community 2 - "Penalties & Scoring API"
Cohesion: 0.05
Nodes (73): requireAuth, getGroupMembership(), getGroupMembershipTimed(), body, candidate, candidates, competition_id, countResult (+65 more)

### Community 3 - "Rounds & Round Reminders"
Cohesion: 0.07
Nodes (57): HMAC_SHA256, importHmacKey(), base64UrlDecode(), base64UrlEncode(), buf, decoded, encoded, original (+49 more)

### Community 4 - "Feature Flags & Permissions"
Cohesion: 0.05
Nodes (52): EmailError, sendEmail, notifications/email.test, hashUserId, logEvent, observability/events.test, dayBounds, exportEventsToR2 (+44 more)

### Community 5 - "Groups Router"
Cohesion: 0.12
Nodes (36): KNOCKOUT_LABELS, roundLabel(), EmailError, EmailMessage, sendEmail(), body, buildEmailHtml(), buildEmailText() (+28 more)

### Community 6 - "UI Primitives & API Cache"
Cohesion: 0.1
Nodes (42): AdminMetricsPage(), ArchiveResponse, ArchiveSection(), buildApiCallsSeries(), buildStackedSeries(), ConcentrationSection(), CRON_INFO, EmailSection() (+34 more)

### Community 7 - "Auth/Groups Router Tests"
Cohesion: 0.06
Nodes (41): ADR-001 Cloudflare D1, ADR-003 Workers + Hono, ADR-004 Runtime prediction locking, ADR-005 Direct Google OAuth, ADR-006 Vite + React static site, ADR-007 Cron result poller, ADR-008 GET /matches caching, ADR-009 Round reminder e-mail (Resend) (+33 more)

### Community 8 - "Metrics Charts & Formatters"
Cohesion: 0.07
Nodes (22): CreatedGroup, CreateGroupSuccessViewProps, ScoringRulesFieldProps, VisibilityFieldProps, PRESET_LABELS, PRESET_VALUES, SCORING_HELP_TEXT, ScoringPreset (+14 more)

### Community 9 - "Metrics Router"
Cohesion: 0.05
Nodes (36): 🔐 Authentication, Backend (API), Competition, 📏 Constraints, 🧱 Core Product Concept, 🧠 Design Principles, ⚽ Domain Model, Excluded (future): (+28 more)

### Community 10 - "Group Picks & Leaderboard"
Cohesion: 0.08
Nodes (27): computeSelectedOutcome(), formatDate(), LockedPredictionView(), Match, MatchCard(), MatchCardProps, MatchScoreRow(), Outcome (+19 more)

### Community 11 - "GA4 Analytics & Consent"
Cohesion: 0.15
Nodes (27): FEATURE_KEYS, FeatureFlags, FeatureKey, getFeatureFlags(), hasFeatureAccess(), flags, flags1, flags2 (+19 more)

### Community 12 - "Create Group Modal & Presets"
Cohesion: 0.12
Nodes (18): GroupMember, GroupPicksResponse, GroupPicksTab(), GroupPicksTabProps, MatchPicksCard(), MemberPrediction, applyDefaultRound(), isGroupStageRound() (+10 more)

### Community 13 - "Match Card"
Cohesion: 0.06
Nodes (30): Click Analytics (trackEvent), Server-side Observability (logEvent), Prediction Locking (before match start), Ranking Tie-breakers, Scoring Rules (exact=3, outcome=1), CLAUDE.md Project Instructions, 0003 bracket picks, 0008 group scoring config (+22 more)

### Community 14 - "Crypto & OAuth Helpers"
Cohesion: 0.13
Nodes (14): trackEvent(), RenameGroupModal(), RenameGroupModalProps, FormViewProps, JoinedGroup, JoinGroupModalProps, apiFetch(), consumeSessionExpired() (+6 more)

### Community 15 - "API Cache Layer"
Cohesion: 0.12
Nodes (20): fetchCachedJson, invalidateApiCache, Button, Button.test, Card, Card.test, buildApiUrl, ConfirmModal (+12 more)

### Community 16 - "Events Export to R2"
Cohesion: 0.17
Nodes (24): CompetitionType, computeStandings(), emptyStanding(), FORM_GLYPHS, formatDay(), FormEntry, GroupMatchesModal(), isLeagueTable() (+16 more)

### Community 17 - "Group Detail Page & Tabs"
Cohesion: 0.11
Nodes (14): GroupDetail, GroupDetailPage(), GroupDetailPageProps, parseTab(), Tab, TAB_LABELS, TABS, useGroupActions() (+6 more)

### Community 18 - "Matches Router Tests"
Cohesion: 0.16
Nodes (15): DashboardPage(), DashboardPageProps, EmptyState(), GroupsList(), User, useDashboardGroups(), UseDashboardGroupsParams, { rerender } (+7 more)

### Community 19 - "Group Picks Fixtures"
Cohesion: 0.14
Nodes (19): makeMatch(), match, MOCK_TIME, oneHourBefore, oneHourLater, GroupPicksResponse, li, matches (+11 more)

### Community 20 - "Google OAuth"
Cohesion: 0.11
Nodes (23): Analytics (GA4 click events), Pages API proxy onRequest, applyDefaultRound, BallIcon, click_<context>_<acao> naming, fetchCachedJson, GA4 Consent Mode v2, GoogleLoginButton (barrel) (+15 more)

### Community 21 - "Page Components & Titles"
Cohesion: 0.17
Nodes (16): dialog, fetchSpy, mockResponse(), mockTrackEvent, user, AdminMetricsPage, App(), AuthStatus (+8 more)

### Community 22 - "Auth Router & Cookies"
Cohesion: 0.17
Nodes (10): Consent, getStoredConsent(), initGa(), setConsent(), Window, CookieConsent(), mockGetStoredConsent, mockSetConsent (+2 more)

### Community 23 - "Cookie Consent & GA Init"
Cohesion: 0.14
Nodes (22): importHmacKey, base64UrlDecode, base64UrlEncode, discoverFixtures, buildAuthUrl, exchangeCode, generatePkce, upsertUser (+14 more)

### Community 24 - "Google Login Button"
Cohesion: 0.22
Nodes (13): BrowserFrame(), Cta(), Faq(), FaqItem(), FeatureRow(), Features(), Footer(), Header() (+5 more)

### Community 25 - "Match Poller"
Cohesion: 0.22
Nodes (10): LeaderboardTab(), LeaderboardTabProps, Member, UserPrediction, formatDate(), groupedByGroupName(), PredictionsModal(), PredictionsModalProps (+2 more)

### Community 26 - "JWT Middleware"
Cohesion: 0.11
Nodes (16): Bônus — alertas, code:sql (SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day), code:sql (SELECT blob1 AS event_type, SUM(_sample_interval) AS count), code:sql (SELECT blob2 AS status,), code:sql (SELECT COUNT(DISTINCT blob4) AS users), Comparação com a Opção B (dashboard nativo), Dashboard de métricas — Opção A: Grafana Cloud, O que o Grafana cobre (e o que não) (+8 more)

### Community 27 - "Fixture Discovery & Polling"
Cohesion: 0.11
Nodes (17): code:mermaid (erDiagram), code:sql (PRAGMA foreign_keys = ON;), `competitions`, Database Schema — Palpitae, Entities, Entity Relationship Diagram, `group_members`, `groups` (+9 more)

### Community 28 - "Header Component"
Cohesion: 0.11
Nodes (17): ✅ Alta Confiança, Anti-Abuse Strategy (MVP), ⚠️ Corrigido, ✅ In Scope, Key Assumptions to Validate, MVP Scope, Next Steps, Not Doing (and Why) (+9 more)

### Community 29 - "Governance & Domain Rules"
Cohesion: 0.11
Nodes (16): 1. Mesmo provider, mesma competição, 2. Regras de pontuação idênticas (validado em produção), 3. Usuários — todos existem no prod do Palpitae, 4. Volume no prod do bolão (2026-07-12), 5. Infra do Palpitae já é genérica por competição, code:block1 (bolao.predictions ──┐), code:sql (-- Divergência de pontos (bolão): 0 linhas divergentes), Consultas de validação usadas (read-only) (+8 more)

### Community 30 - "HMAC Crypto & Tokens"
Cohesion: 0.12
Nodes (14): Analytics Engine — hot path (retenção ~3 meses), Arquitetura, As 3 camadas (não confundir), code:ts (import { hashUserId, logEvent } from '../observability'), Dashboard de métricas, Decisões descartadas — NÃO re-propor, Esquema e convenção de eventos, Esquema posicional por evento (+6 more)

### Community 31 - "Match Sync & API Mapping"
Cohesion: 0.23
Nodes (11): Header(), HeaderProps, baseUser, link, mockTrackEvent, onCreateGroup, onJoinGroup, onLogout (+3 more)

### Community 32 - "Group Fetch Test Mocks"
Cohesion: 0.13
Nodes (13): Bônus de pênalti (`points_penalty`), Campos (tabela `groups`), Configuração de pontuação e visibilidade por grupo, `exact_hits` no leaderboard, Gate por `(competição, fase)` — fonte de verdade `competitions.penalty_phases`, Invariantes (validadas na API **e** no front), Modo 1X2 (`points_exact = 0`), Observabilidade (+5 more)

### Community 33 - "Observability Events Core"
Cohesion: 0.22
Nodes (7): ConfirmModal(), ConfirmModalProps, ConfirmOptions, cancelButton, confirmButton, TestComponent(), triggerButton

### Community 34 - "Match Sync Tests"
Cohesion: 0.29
Nodes (5): GroupCard(), GroupCardProps, GroupWithStats, baseGroup, onClick

### Community 35 - "Join Group Modal"
Cohesion: 0.3
Nodes (10): body, competitions, createdGroup, defaultProps, exact, fetchSpy, infoBtn, mockFetchCompetitions() (+2 more)

### Community 36 - "Base64 Encoding"
Cohesion: 0.42
Nodes (9): buildFakeDb(), Captured, { db, captured }, { db, sqls }, m, match(), mockFetch(), ScoreOverrides (+1 more)

### Community 37 - "Landing Page"
Cohesion: 0.3
Nodes (10): baseGroup, baseUser, fetchSpy, input, mockGroupFetch(), mockGroupFetchSequence(), mockTrackEvent, renderPage() (+2 more)

### Community 38 - "Predictions & Standings Tabs"
Cohesion: 0.17
Nodes (11): A. Ativar e verificar o GA4 em produção *(ação do dono — sem código)*, ⏸️ Adiado por design — só fazer quando o gatilho existir, B. Keyword research *(depende de tráfego acumular no Search Console)*, C. Bing Webmaster Tools *(ação do dono — sem código)*, context-seo.md — SEO, Performance & Analytics, Contexto do projeto (o que importa aqui), D. Link building *(ação do dono — sem código)*, ❌ Decisões descartadas — NÃO re-propor (+3 more)

### Community 39 - "Unsubscribe Router"
Cohesion: 0.35
Nodes (9): here, lines, loadDevVars(), mapStatus(), q(), qn(), slugify(), status (+1 more)

### Community 40 - "Group Card"
Cohesion: 0.18
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 41 - "App Routing"
Cohesion: 0.36
Nodes (7): useConfirm(), Member, MemberItem(), MemberItemProps, MembersTab(), MembersTabProps, useMembers()

### Community 42 - "Settings Page"
Cohesion: 0.2
Nodes (9): API — Setup local, code:bash (cd api), code:bash (# Start local dev server (http://localhost:8787)), code:bash (# Set production secrets (one-time, stored encrypted in Clou), Deploying, First-time setup, Palpitae, Prerequisites (+1 more)

### Community 43 - "Cookie Consent GA"
Cohesion: 0.2
Nodes (7): Analytics — eventos de clique (GA4, lado cliente), code:ts (import { trackEvent } from '../../analytics/ga'), Consentimento e LGPD, Convenções de nome, Eventos já mapeados, O que rastrear vs. ignorar, Regra

### Community 44 - "Router Test Helpers"
Cohesion: 0.31
Nodes (5): BallIcon(), PenaltyBadge(), PenaltyBadgeProps, button, onActivate

### Community 45 - "Results API Script"
Cohesion: 0.31
Nodes (3): Modal(), ModalProps, onClose

### Community 46 - "Card Component"
Cohesion: 0.25
Nodes (9): fetchCachedJson, Modal, BallIcon, PenaltyBadge, PredictionsTab, applyDefaultRound, isGroupStageRound, StandingsTab (+1 more)

### Community 47 - "Modal Component"
Cohesion: 0.61
Nodes (5): env, fetchMatches(), loadDevVars(), main(), summarizeMatches()

### Community 48 - "Button Component"
Cohesion: 0.36
Nodes (3): Button(), ButtonProps, onClick

### Community 49 - "Confirm Modal"
Cohesion: 0.43
Nodes (6): fetchSpy, mockResponse(), mockTrackEvent, patchCall, renderPage(), user

### Community 50 - "Penalty Badge"
Cohesion: 0.43
Nodes (6): corsHeaders, dialog, editMenuText, leaveGroupBtn, method, url

### Community 51 - "Admin Metrics Charts"
Cohesion: 0.25
Nodes (8): ADR-007: Result Sync Strategy — Cron-Triggered Time-Window Poller, Alternatives Considered, code:block1 (First half:           45 min), code:sql (SELECT DISTINCT c.id AS comp_id, c.external_id, c.season, m.), Consequences, Context, Decision, Implementation

### Community 52 - "Wrangler Config Test"
Cohesion: 0.25
Nodes (7): 1. 🧪 Testes Manuais (Checklist), 2. 🤖 Sugestão de Testes E2E (Playwright), A. Fluxo de Grupos (Create / View / Join), B. Fluxo de Palpites (Predictions), C. Sincronização e Matches no Background, Cenário 1: "Happy Path - Criar grupo, alterar rodada e fazer palpite", Test Plan Post-Refactoring

### Community 53 - "Football-data Fetch"
Cohesion: 0.48
Nodes (5): dump, here, lines, perUser, USER_MAP

### Community 54 - "Penalty Parsing"
Cohesion: 0.38
Nodes (3): GoogleLoginButton(), GoogleLogo(), mockTrackEvent

### Community 55 - "SEO Assets"
Cohesion: 0.48
Nodes (5): body, defaultProps, fetchSpy, joinedGroup, mockTrackEvent

### Community 56 - "Group Card Types"
Cohesion: 0.38
Nodes (3): ErrorState(), ErrorStateProps, { container }

### Community 57 - "Brand Logo SVGs"
Cohesion: 0.29
Nodes (5): Dashboard Nativo (Admin Metrics) — ideias futuras, Descartado — NÃO re-propor, Ideias pendentes, Linha de referência de quota da API Football, Mapa de calor por horário

### Community 58 - "Brand Logo Variants"
Cohesion: 0.29
Nodes (5): ADR-008: Caching Strategy for `GET /matches` — Content-Derived TTL + Edge Cache API, Architecture Decision Records, Consequences, Context, Decision

### Community 59 - "App Icons & Social Card"
Cohesion: 0.38
Nodes (7): CookieConsent, CookieConsent.test, gaEnabled, getStoredConsent, initGa, setConsent, ga.test

### Community 60 - "Community 60"
Cohesion: 0.33
Nodes (3): CardProps, { container }, div

### Community 61 - "Community 61"
Cohesion: 0.6
Nodes (3): members, mockFetch(), mockTrackEvent

### Community 62 - "Community 62"
Cohesion: 0.53
Nodes (4): consoleErrorSpy, getItemSpy, result, setItemMock

### Community 63 - "Community 63"
Cohesion: 0.53
Nodes (4): corsHeaders, inputs, tomorrow, url

### Community 64 - "Community 64"
Cohesion: 0.53
Nodes (4): corsHeaders, method, modal, url

### Community 65 - "Community 65"
Cohesion: 0.53
Nodes (4): corsHeaders, dialog, method, reminderLabel

### Community 66 - "Community 66"
Cohesion: 0.33
Nodes (6): ADR-009: Round Reminder Notifications — Transactional E-mail via Resend, Alternatives Considered, Consequences, Context, Decision, Implementation

### Community 67 - "Community 67"
Cohesion: 0.33
Nodes (6): ADR-006: Frontend Stack — Vite + React (Static Site), Consequences, Context, Decision, Design Token System, Why not Next.js / Remix?

### Community 68 - "Community 68"
Cohesion: 0.33
Nodes (6): ADR-010: Fixture Discovery — Daily Full-Competition Sync Cron, Consequences, Context, Decision, Why a full sync (not "wait for the round to end"), Why not reuse the existing crons

### Community 69 - "Community 69"
Cohesion: 0.6
Nodes (3): btnEntrar, corsHeaders, googleBtn

### Community 70 - "Community 70"
Cohesion: 0.6
Nodes (3): Analytics — eventos de clique (obrigatório), graphify, Observabilidade — eventos server-side (obrigatório)

### Community 71 - "Community 71"
Cohesion: 0.4
Nodes (5): ADR-005: Authentication — Direct Google OAuth 2.0, Consequences, Context, Decision, Security Requirements

### Community 72 - "Community 72"
Cohesion: 0.4
Nodes (5): ADR-002: Migration Strategy — Wrangler D1 Migrations, Consequences, Context, Decision, Rules

### Community 76 - "Community 76"
Cohesion: 0.5
Nodes (3): Overview, System Architecture — Palpitae, Working with Architecture

### Community 77 - "Community 77"
Cohesion: 0.5
Nodes (4): ADR-011: Brasileirão Série A 2026 — Data Migration from bolao-brasileirao, Consequences, Context, Decision

### Community 78 - "Community 78"
Cohesion: 0.5
Nodes (4): ADR-012: Standings Tab — Data-Driven Competition-Type Gate, Consequences, Context, Decision

### Community 79 - "Community 79"
Cohesion: 0.5
Nodes (4): ADR-003: API Runtime — Cloudflare Workers + Hono, Consequences, Context, Decision

### Community 80 - "Community 80"
Cohesion: 0.5
Nodes (4): ADR-004: Prediction Locking — Derived at Runtime, Consequences, Context, Decision

### Community 81 - "Community 81"
Cohesion: 0.5
Nodes (4): ADR-001: Database Platform — Cloudflare D1, Consequences, Context, Decision

### Community 82 - "Community 82"
Cohesion: 0.67
Nodes (4): AdminMetricsPage, BarChart, StackedBarChart, useDocumentTitle

### Community 85 - "Community 85"
Cohesion: 0.67
Nodes (3): fetchMatches (football-data.org), test-results-api main, summarizeMatches

### Community 86 - "Community 86"
Cohesion: 0.67
Nodes (3): matchGoesToPenalties, parsePenaltyPhases, competitionsRouter

### Community 89 - "Community 89"
Cohesion: 1.0
Nodes (3): Palpitae Icon (green on black), Palpitae Icon (green on white), Palpitae Wordmark + Icon Logo

### Community 90 - "Community 90"
Cohesion: 1.0
Nodes (3): Palpitae App Icon, Palpitae Logo (Black variant), Palpitae Logo (Green variant)

### Community 91 - "Community 91"
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
- **358 isolated node(s):** `PackageJson`, `[, body]`, `payload`, `[h, , s]`, `tamperedBody` (+353 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

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
- **Why does `AppContext` connect `Architecture Decision Records` to `GA4 Analytics & Consent`, `Notifications & Observability`, `Penalties & Scoring API`, `Rounds & Round Reminders`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `trackEvent()` connect `Crypto & OAuth Helpers` to `UI Primitives & API Cache`, `Metrics Charts & Formatters`, `App Routing`, `Group Picks & Leaderboard`, `Create Group Modal & Presets`, `Results API Script`, `Events Export to R2`, `Group Detail Page & Tabs`, `Matches Router Tests`, `Penalty Parsing`, `Auth Router & Cookies`, `Google Login Button`, `Match Poller`, `Match Sync & API Mapping`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `config` connect `Page Components & Titles` to `Metrics Charts & Formatters`, `App Routing`, `Group Picks & Leaderboard`, `Create Group Modal & Presets`, `Crypto & OAuth Helpers`, `Events Export to R2`, `Group Detail Page & Tabs`, `Confirm Modal`, `Penalty Parsing`, `Auth Router & Cookies`, `Match Poller`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._