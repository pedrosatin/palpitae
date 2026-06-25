# Graph Report - palpitae  (2026-06-25)

## Corpus Check
- 141 files · ~79,255 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1390 nodes · 2454 edges · 96 communities (90 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.63)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `21a4387b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
- [[_COMMUNITY_Google Login Button|Google Login Button]]
- [[_COMMUNITY_Brand SVG Assets|Brand SVG Assets]]
- [[_COMMUNITY_Pages Function Proxy|Pages Function Proxy]]
- [[_COMMUNITY_Web App Entry|Web App Entry]]
- [[_COMMUNITY_Icon SVG Assets|Icon SVG Assets]]
- [[_COMMUNITY_API Vitest Config|API Vitest Config]]
- [[_COMMUNITY_Web Vite Config|Web Vite Config]]
- [[_COMMUNITY_Vite Env Types|Vite Env Types]]
- [[_COMMUNITY_Web Test Setup|Web Test Setup]]
- [[_COMMUNITY_Dashboard Page Barrel|Dashboard Page Barrel]]
- [[_COMMUNITY_Group Detail Page Barrel|Group Detail Page Barrel]]
- [[_COMMUNITY_Login Page Barrel|Login Page Barrel]]
- [[_COMMUNITY_Bracket Tab Barrel|Bracket Tab Barrel]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
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

## God Nodes (most connected - your core abstractions)
1. `config` - 37 edges
2. `AppContext` - 29 edges
3. `signJwt()` - 26 edges
4. `🧠 Palpitae — Product Vision` - 24 edges
5. `ADR-006: Frontend Stack — Vite + React (Static Site)` - 21 edges
6. `🤖 AGENTS.md — Palpitae` - 19 edges
7. `trackEvent()` - 16 edges
8. `SlotData` - 16 edges
9. `base64UrlEncode()` - 15 edges
10. `requireAuth` - 15 edges

## Surprising Connections (you probably didn't know these)
- `base64UrlEncode()` --calls--> `signJwt()`  [EXTRACTED]
  /home/satin/Work/palpitae/api/src/auth/encoding.ts → api/src/auth/jwt.ts
- `signUnsubToken()` --calls--> `base64UrlEncode()`  [EXTRACTED]
  api/src/notifications/unsubscribeToken.ts → /home/satin/Work/palpitae/api/src/auth/encoding.ts
- `base64UrlDecode()` --calls--> `verifyJwt()`  [EXTRACTED]
  /home/satin/Work/palpitae/api/src/auth/encoding.ts → api/src/auth/jwt.ts
- `verifyUnsubToken()` --calls--> `base64UrlDecode()`  [EXTRACTED]
  api/src/notifications/unsubscribeToken.ts → /home/satin/Work/palpitae/api/src/auth/encoding.ts
- `importKey()` --calls--> `signJwt()`  [EXTRACTED]
  /home/satin/Work/palpitae/api/src/auth/jwt.ts → api/src/auth/jwt.ts

## Communities (96 total, 6 thin omitted)

### Community 0 - "Bracket UI Components"
Cohesion: 0.06
Nodes (67): BracketColumn(), BracketColumnProps, ROUND_INDEX, column, { container }, renderColumn(), slot(), slots (+59 more)

### Community 1 - "API Routers & Auth Middleware"
Cohesion: 0.06
Nodes (53): HMAC_SHA256, importHmacKey(), base64UrlDecode(), base64UrlEncode(), buf, decoded, encoded, original (+45 more)

### Community 2 - "Auth Encoding & Google OAuth"
Cohesion: 0.05
Nodes (44): makeMatch(), defaultRoundIndex(), GroupMember, GroupPicksResponse, GroupPicksTab(), GroupPicksTabProps, MemberPrediction, GroupPicksResponse (+36 more)

### Community 3 - "Architecture Decision Records"
Cohesion: 0.05
Nodes (53): ActiveRound, pollActiveMatches(), EmailError, EmailMessage, sendEmail(), body, buildEmailHtml(), buildEmailText() (+45 more)

### Community 4 - "Create Group Modal (legacy)"
Cohesion: 0.11
Nodes (34): buildAuthUrl(), exchangeCode(), generateNonce(), generatePkce(), generateState(), GoogleIdTokenClaims, GoogleUserInfo, JwksKey (+26 more)

### Community 5 - "Dashboard & Group Detail Pages"
Cohesion: 0.05
Nodes (36): 🔐 Authentication, Backend (API), Competition, 📏 Constraints, 🧱 Core Product Concept, 🧠 Design Principles, ⚽ Domain Model, Excluded (future): (+28 more)

### Community 6 - "Predictions Tab (legacy)"
Cohesion: 0.12
Nodes (29): byMatch, groupConfig, groupId, importStatements, locked, match, matchId, matchIds (+21 more)

### Community 7 - "Bracket API Router"
Cohesion: 0.12
Nodes (26): allPicksBySlot, allPicksResult, byPos, competitionId, data, ensureSlot(), groupId, KNOCKOUT_PHASES (+18 more)

### Community 8 - "App Entry & Login"
Cohesion: 0.08
Nodes (23): code:json (// Jogo decidido nos 90 min), code:block2 (Jogo REGULAR ou EXTRA_TIME (não houve pênaltis):), code:block3 (pontos = calculatePoints(homeScore, awayScore, predHome, pre), code:sql (-- migration 0008_penalty_picks.sql), code:typescript (score: {), code:sql (-- Condição extra no WHERE de scoreUnprocessedMatches:), code:typescript (// predictions/router.ts — POST e PUT quando penalty pick é ), code:typescript (trackEvent('click_prediction_penalty_winner')  // ao selecio) (+15 more)

### Community 9 - "Match Card Component"
Cohesion: 0.16
Nodes (22): body, candidate, competition_id, countResult, dbStartedAt, generateInviteCode(), group, groupId (+14 more)

### Community 10 - "Predictions Tab Component"
Cohesion: 0.11
Nodes (14): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, input, pastMatch, saveBtn (+6 more)

### Community 11 - "Group Card (legacy)"
Cohesion: 0.16
Nodes (13): dialog, fetchSpy, mockResponse(), mockTrackEvent, user, GoogleLoginButton(), GoogleLogo(), Member (+5 more)

### Community 12 - "Group Card Component"
Cohesion: 0.16
Nodes (18): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, awayInput, body, fetchSpy (+10 more)

### Community 13 - "Fixture Sync (API Football)"
Cohesion: 0.12
Nodes (8): GroupDetail, GroupDetailPage(), GroupDetailPageProps, parseTab(), Tab, TAB_LABELS, TABS, User

### Community 14 - "Create Group Modal"
Cohesion: 0.13
Nodes (18): cacheKey, competition, competitionId, dbStartedAt, defaultRoundRow, firstOpen, MatchRow, maybeSyncResults() (+10 more)

### Community 15 - "Button & Header (legacy)"
Cohesion: 0.13
Nodes (11): Consent, getStoredConsent(), initGa(), setConsent(), Window, mockGetStoredConsent, mockSetConsent, mockTrackEvent (+3 more)

### Community 16 - "Join Group Modal"
Cohesion: 0.16
Nodes (10): trackEvent(), DashboardPage(), DashboardPageProps, User, useDocumentTitle(), LoginPage(), SettingsPage(), SettingsPageProps (+2 more)

### Community 17 - "Header Tests (legacy)"
Cohesion: 0.11
Nodes (17): code:mermaid (erDiagram), code:sql (PRAGMA foreign_keys = ON;), `competitions`, Database Schema — Palpitae, Entities, Entity Relationship Diagram, `group_members`, `groups` (+9 more)

### Community 18 - "Group Detail Page Tests (legacy)"
Cohesion: 0.11
Nodes (17): ✅ Alta Confiança, Anti-Abuse Strategy (MVP), ⚠️ Corrigido, ✅ In Scope, Key Assumptions to Validate, MVP Scope, Next Steps, Not Doing (and Why) (+9 more)

### Community 19 - "Group Detail Page (legacy)"
Cohesion: 0.11
Nodes (18): 🤖 AGENTS.md — Palpitae, 📊 Analytics — GA Events (obrigatório), ⚠️ Anti-Patterns (Avoid), 🏗️ Architecture Guidelines, 🧩 Code Guidelines, 🗄️ Database Rules, ⚽ Domain Rules (Critical), 🧠 General Principles (+10 more)

### Community 20 - "Modal (legacy)"
Cohesion: 0.11
Nodes (18): ADR-006: Frontend Stack — Vite + React (Static Site), Consequences, Consequences, Consequences, Consequences, Consequences, Consequences, Context (+10 more)

### Community 21 - "Card (legacy)"
Cohesion: 0.15
Nodes (18): 1. `api/wrangler.toml` — adicionar Cron Trigger, 1. Configurar domínio de envio no Resend, 1. `default_round: null/undefined` → mostra rodada 1 em vez da última, 1. Filtro inteligente — notificar só quem NÃO palpitou ainda (PRIORIDADE ALTA), 2. Adicionar `RESEND_API_KEY` ao projeto, 2. `api/src/matches/scoring.ts`, 2. Null user returns `round_reminders: true` instead of 404 (MEDIUM), 2. Query de `default_round` ignora filtros `?round=X` / `?status=X` (+10 more)

### Community 22 - "Card Component"
Cohesion: 0.12
Nodes (7): App(), AuthStatus, DashboardPage, GroupDetailPage, SettingsPage, User, rootEl

### Community 23 - "Modal Component"
Cohesion: 0.12
Nodes (16): Bug 1 — CRITICAL: Outcome-only groups score 0 for correct picks on canonical scores, Bug 2 — HIGH: selectedOutcome shows no pressed button during first-time prediction save, Bug 3 — MEDIUM: Race between selectOutcome and "Salvar todos", Bug 4 — LOW: selectOutcome fires persist even when outcome is unchanged, Bug 5 — LOW: Wrong error code (403 vs 404) for soft-deleted group in predictions router, Bug 6 — LOW: Custom points inputs allow float values that pass client validation, Cleanup — Duplicate SQL blocks for public vs hidden predictions, Code Review — Scoring Config & Visibility Feature (+8 more)

### Community 24 - "Team Badge Component"
Cohesion: 0.16
Nodes (11): app, cacheHeaderFor(), counter, createMatchesDbMock(), env, fakeEnv(), first, second (+3 more)

### Community 25 - "Dashboard Page Tests (legacy)"
Cohesion: 0.17
Nodes (16): 1. `GroupDetailPage.tsx` — adicionar a aba, 2. Segurança — XSS no template HTML (BUG), 3. `api/src/groups/router.ts`, 3. Criar módulo de notificação, 3. Observabilidade — nenhum evento de negócio registrado (GAP), 3. Recipient dedup uses email instead of user_id — wrong unsubscribe token (MEDIUM), 4. Registrar cron diário no `index.ts`, 4. Testes — gaps no `roundReminder.test.ts` (+8 more)

### Community 26 - "Button Component"
Cohesion: 0.28
Nodes (8): requireAuth, app, buildApp(), fakeEnv(), requestWithCookie(), router, AppContext, Variables

### Community 27 - "Google Login Button"
Cohesion: 0.13
Nodes (9): GroupCardProps, GroupWithStats, baseGroup, onClick, DashboardPageProps, dialog, fetchSpy, user (+1 more)

### Community 28 - "Brand SVG Assets"
Cohesion: 0.12
Nodes (8): Competition, CreatedGroup, CreateGroupModalProps, competitions, createdGroup, defaultProps, ModalProps, onClose

### Community 29 - "Pages Function Proxy"
Cohesion: 0.16
Nodes (5): BrowserFrame(), FeatureRow(), LandingPage(), ScoreCard(), mockTrackEvent

### Community 30 - "Web App Entry"
Cohesion: 0.22
Nodes (11): Header(), HeaderProps, baseUser, link, mockTrackEvent, onCreateGroup, onJoinGroup, onLogout (+3 more)

### Community 31 - "Icon SVG Assets"
Cohesion: 0.16
Nodes (15): API externa, Arquivos novos a criar, context.md — Tarefa atual: Result Sync & Scoring, Convenções do projeto, Cooldown / proteção de rate limit, Decisões tomadas, Fluxo acordado, Leaderboard (+7 more)

### Community 32 - "API Vitest Config"
Cohesion: 0.14
Nodes (13): Analytics Engine — hot path (retenção ~3 meses), Arquitetura, As 3 camadas (não confundir), code:ts (import { hashUserId, logEvent } from '../observability'), Decisões descartadas — NÃO re-propor, Esquema e convenção de eventos, Esquema posicional por evento, LGPD / privacidade (+5 more)

### Community 33 - "Web Vite Config"
Cohesion: 0.14
Nodes (8): ButtonProps, onClick, JoinedGroup, JoinGroupModalProps, body, defaultProps, fetchSpy, joinedGroup

### Community 34 - "Vite Env Types"
Cohesion: 0.14
Nodes (10): ActiveRow, ae, db, [earliestOver, stillRelevant], errors, matchdays, runs, scoreMock (+2 more)

### Community 35 - "Web Test Setup"
Cohesion: 0.19
Nodes (8): Competition, CreatedGroup, CreateGroupModal(), CreateGroupModalProps, PRESET_LABELS, PRESET_VALUES, SCORING_HELP_TEXT, ScoringPreset

### Community 36 - "Dashboard Page Barrel"
Cohesion: 0.15
Nodes (8): GroupDetail, GroupDetailPageProps, Tab, baseGroup, baseUser, fetchSpy, spy, User

### Community 37 - "Group Detail Page Barrel"
Cohesion: 0.26
Nodes (9): baseGroup, baseUser, fetchSpy, input, mockGroupFetch(), mockTrackEvent, renderPage(), spy (+1 more)

### Community 38 - "Login Page Barrel"
Cohesion: 0.21
Nodes (10): body, competitions, createdGroup, defaultProps, exact, fetchSpy, infoBtn, mockFetchCompetitions() (+2 more)

### Community 39 - "Bracket Tab Barrel"
Cohesion: 0.26
Nodes (8): JoinedGroup, JoinGroupModal(), JoinGroupModalProps, body, defaultProps, fetchSpy, joinedGroup, mockTrackEvent

### Community 40 - "Community 40"
Cohesion: 0.17
Nodes (11): A. Ativar e verificar o GA4 em produção *(ação do dono — sem código)*, ⏸️ Adiado por design — só fazer quando o gatilho existir, B. Keyword research *(depende de tráfego acumular no Search Console)*, C. Bing Webmaster Tools *(ação do dono — sem código)*, context-seo.md — SEO, Performance & Analytics, Contexto do projeto (o que importa aqui), D. Link building *(ação do dono — sem código)*, ❌ Decisões descartadas — NÃO re-propor (+3 more)

### Community 41 - "Community 41"
Cohesion: 0.23
Nodes (11): API Football (External Provider), Competitions Domain Module, Groups Domain Module, Leaderboard Domain Module, Matches Domain Module, Payments Domain Module, Predictions Domain Module, Palpitae Refined Ideation (+3 more)

### Community 42 - "Community 42"
Cohesion: 0.18
Nodes (12): 1. `api/migrations/0008_group_scoring_config.sql` — NOVO, 1. `await hashUserId` inside `catch` aborts batch (HIGH), 6. UI simplificada de palpite (quando `points_exact = 0`), Arquivos a criar, Arquivos a criar/modificar, code:sql (ALTER TABLE groups ADD COLUMN points_exact INTEGER NOT NULL ), Decisões em aberto, Decisões resolvidas na implementação (+4 more)

### Community 43 - "Community 43"
Cohesion: 0.18
Nodes (8): body, router, row, token, userId, logRequestPerf(), RequestPerfMetrics, roundMs()

### Community 44 - "Community 44"
Cohesion: 0.17
Nodes (3): CardProps, { container }, div

### Community 45 - "Community 45"
Cohesion: 0.17
Nodes (8): HeaderProps, baseUser, link, onCreateGroup, onJoinGroup, onLogout, sairBtn, User

### Community 46 - "Community 46"
Cohesion: 0.29
Nodes (10): batchSpy, buildFakeDb(), db, FakeGroupConfig, FakeMatch, FakePrediction, matches, predictions (+2 more)

### Community 47 - "Community 47"
Cohesion: 0.2
Nodes (11): ApiCompetition, ApiMatch, ApiMatchesResponse, ApiTeam, COMP_TRANSLATIONS, mapStatus(), slugify(), syncFixtures() (+3 more)

### Community 48 - "Community 48"
Cohesion: 0.36
Nodes (9): Cloudflare D1 (SQLite), Cloudflare Pages, Cloudflare Workers, Architecture Decision Records, Auth Domain Module, Google OAuth 2.0, Hono Framework, Vite + React (Frontend Stack) (+1 more)

### Community 49 - "Community 49"
Cohesion: 0.42
Nodes (11): Competitions Entity, Group Members Entity, Groups Entity, Leaderboard Entity, Matches Entity, Payments Entity, Predictions Entity, Profiles Entity (+3 more)

### Community 50 - "Community 50"
Cohesion: 0.18
Nodes (11): 2. `api/src/matches/poller.ts` (implementado), 2. Novo arquivo: `api/src/matches/poller.ts`, 3. `api/src/index.ts` — handler `scheduled` (implementado), 4. `api/src/matches/router.ts` — sem mudança, 4. `api/src/matches/router.ts` — sem mudança agora, Arquivos tocados, Decisões, Janela de tempo (+3 more)

### Community 51 - "Community 51"
Cohesion: 0.24
Nodes (11): 10. O(n²) `Array.find()` scan in recipient dedup (LOW — efficiency), 2. `StandingsTab.tsx` — componente principal, 4. `api/src/predictions/router.ts` — `GET /predictions/group`, 4. Duplicate `default_round` correlated subquery in Q1 and Q2 (MEDIUM — maintenance/correctness), 7. Misconfig and "no rounds today" produce identical metrics (LOW), 8. `importKey` duplicated from `auth/jwt.ts` (LOW — maintenance), 9. `hashUserId(id)` called twice per failed send (LOW — efficiency), Code Review Findings — branch `add-email-notification` (+3 more)

### Community 52 - "Community 52"
Cohesion: 0.2
Nodes (9): ADR-001: Database Platform — Cloudflare D1, ADR-004: Prediction Locking — Derived at Runtime, Architecture Decision Records, Consequences, Consequences, Context, Context, Decision (+1 more)

### Community 53 - "Community 53"
Cohesion: 0.2
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 54 - "Community 54"
Cohesion: 0.2
Nodes (9): API — Setup local, code:bash (cd api), code:bash (# Start local dev server (http://localhost:8787)), code:bash (# Set production secrets (one-time, stored encrypted in Clou), Deploying, First-time setup, Palpitae, Prerequisites (+1 more)

### Community 55 - "Community 55"
Cohesion: 0.29
Nodes (5): GroupCard(), GroupCardProps, GroupWithStats, baseGroup, onClick

### Community 56 - "Community 56"
Cohesion: 0.2
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 57 - "Community 57"
Cohesion: 0.22
Nodes (8): Campos (tabela `groups`), Configuração de pontuação e visibilidade por grupo, `exact_hits` no leaderboard, Invariantes (validadas na API **e** no front), Modo 1X2 (`points_exact = 0`), Observabilidade, Presets de UI (CreateGroupModal), Visibilidade

### Community 58 - "Community 58"
Cohesion: 0.22
Nodes (9): ADR-007: Result Sync Strategy — Cron-Triggered Time-Window Poller, Alternatives Considered, code:block1 (First half:           45 min), code:sql (SELECT DISTINCT c.id AS comp_id, c.external_id, c.season, m.), Consequences, Consequences, Context, Decision (+1 more)

### Community 59 - "Community 59"
Cohesion: 0.22
Nodes (9): ADR-009: Round Reminder Notifications — Transactional E-mail via Resend, Alternatives Considered, Alternatives Considered, Consequences, Consequences, Context, Decision, Implementation (+1 more)

### Community 60 - "Community 60"
Cohesion: 0.22
Nodes (9): 3. `StandingsTab.test.tsx` — testes, 4. `index.ts` — barrel export, 5. `web/src/components/CreateGroupModal/CreateGroupModal.tsx`, code:ts (setScoringPreset('classic')), code:ts (function handlePreset(preset: ScoringPreset) {), code:ts (if (pointsExact < pointsWinner) {), code:ts (body: JSON.stringify({), Instruções de implementação (+1 more)

### Community 61 - "Community 61"
Cohesion: 0.22
Nodes (9): Arquivos novos/modificados nessa branch, Checklist de merge, Contexto: Notificação de Nova Rodada por E-mail, Idempotência (sem tabela de controle), Lógica central, O que já está feito, Pendências externas (processos manuais, sem código), Schema crítico para o filtro inteligente (+1 more)

### Community 62 - "Community 62"
Cohesion: 0.36
Nodes (4): Card(), CardProps, { container }, div

### Community 63 - "Community 63"
Cohesion: 0.36
Nodes (4): Modal(), ModalProps, onClose, renderModal()

### Community 64 - "Community 64"
Cohesion: 0.25
Nodes (3): ConfirmModalProps, ConfirmOptions, useConfirm()

### Community 65 - "Community 65"
Cohesion: 0.29
Nodes (6): graphify-out/GRAPH_REPORT.md, Analytics — eventos de clique (obrigatório), graphify, Observabilidade — eventos server-side (obrigatório), SEO, Performance & Analytics, Tarefa atual

### Community 66 - "Community 66"
Cohesion: 0.36
Nodes (4): TeamBadge(), TeamBadgeProps, { container }, img

### Community 67 - "Community 67"
Cohesion: 0.57
Nodes (5): env, fetchMatches(), loadDevVars(), main(), summarizeMatches()

### Community 68 - "Community 68"
Cohesion: 0.38
Nodes (3): Button(), ButtonProps, onClick

### Community 69 - "Community 69"
Cohesion: 0.29
Nodes (6): Analytics — eventos de clique (GA4, lado cliente), code:ts (import { trackEvent } from '../../analytics/ga'), Convenções de nome, Eventos já mapeados, O que rastrear vs. ignorar, Regra

### Community 70 - "Community 70"
Cohesion: 0.33
Nodes (7): 5. Whitespace `RESEND_API_KEY` bypasses the guard (LOW-MEDIUM), 7. `.dev.vars` — não está no repositório, Arquivos relevantes, code:ts (logEvent(c.env.AE, 'group_created', {), code:sql (g.points_exact,), Como testar localmente, Pendências externas (não-código)

### Community 71 - "Community 71"
Cohesion: 0.29
Nodes (4): fetchSpy, mockTrackEvent, patchCall, user

### Community 72 - "Community 72"
Cohesion: 0.73
Nodes (4): calculatePoints(), recalculateLeaderboard(), scoreMatch(), scoreUnprocessedMatches()

### Community 74 - "Community 74"
Cohesion: 0.4
Nodes (3): Overview, System Architecture — Palpitae, Working with Architecture

### Community 75 - "Community 75"
Cohesion: 0.4
Nodes (5): ADR-005: Authentication — Direct Google OAuth 2.0, Consequences, Context, Decision, Security Requirements

### Community 76 - "Community 76"
Cohesion: 0.4
Nodes (5): ADR-002: Migration Strategy — Wrangler D1 Migrations, Consequences, Context, Decision, Rules

### Community 77 - "Community 77"
Cohesion: 0.7
Nodes (3): logRequestPerf(), RequestPerfMetrics, roundMs()

### Community 78 - "Community 78"
Cohesion: 0.5
Nodes (4): ADR-008: Caching Strategy for `GET /matches` — Content-Derived TTL + Edge Cache API, Consequences, Context, Decision

### Community 79 - "Community 79"
Cohesion: 0.5
Nodes (4): ADR-003: API Runtime — Cloudflare Workers + Hono, Consequences, Context, Decision

### Community 81 - "Community 81"
Cohesion: 0.67
Nodes (3): Logo 2 SVG, Logo SVG (Logo.svg), Logo Text SVG

## Knowledge Gaps
- **420 isolated node(s):** `env`, `ctx`, `app`, `KNOWN_OAUTH_ERRORS`, `{ db, updateRun }` (+415 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `config` connect `Group Card (legacy)` to `Bracket UI Components`, `Web Vite Config`, `Auth Encoding & Google OAuth`, `Web Test Setup`, `Dashboard Page Barrel`, `Bracket Tab Barrel`, `Community 71`, `Predictions Tab Component`, `Group Card Component`, `Fixture Sync (API Football)`, `Community 44`, `Button & Header (legacy)`, `Join Group Modal`, `Card Component`, `Google Login Button`, `Brand SVG Assets`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `AppContext` connect `Button Component` to `API Routers & Auth Middleware`, `Architecture Decision Records`, `Create Group Modal (legacy)`, `Predictions Tab (legacy)`, `Bracket API Router`, `Match Card Component`, `Community 43`, `Create Group Modal`, `Team Badge Component`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `env`, `ctx`, `app` to the rest of the system?**
  _420 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bracket UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `API Routers & Auth Middleware` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Auth Encoding & Google OAuth` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Architecture Decision Records` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._