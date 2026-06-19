# Graph Report - palpitae  (2026-06-19)

## Corpus Check
- 134 files · ~66,192 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1158 nodes · 2028 edges · 77 communities (70 shown, 7 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.58)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8e29782e`
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
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]

## God Nodes (most connected - your core abstractions)
1. `config` - 36 edges
2. `AppContext` - 27 edges
3. `🧠 Palpitae — Product Vision` - 24 edges
4. `signJwt()` - 23 edges
5. `🤖 AGENTS.md — Palpitae` - 17 edges
6. `SlotData` - 16 edges
7. `ADR-006: Frontend Stack — Vite + React (Static Site)` - 15 edges
8. `requireAuth` - 14 edges
9. `Round` - 14 edges
10. `Team` - 14 edges

## Surprising Connections (you probably didn't know these)
- `signJwt()` --calls--> `requestWithCookie()`  [EXTRACTED]
  /home/satin/Work/palpitae/api/src/auth/jwt.ts → api/src/auth/router.test.ts
- `signJwt()` --calls--> `request()`  [EXTRACTED]
  /home/satin/Work/palpitae/api/src/auth/jwt.ts → api/src/groups/router.test.ts
- `signJwt()` --calls--> `requestGroupsList()`  [EXTRACTED]
  /home/satin/Work/palpitae/api/src/auth/jwt.ts → api/src/groups/router.test.ts
- `requestRemoveMember()` --calls--> `signJwt()`  [EXTRACTED]
  api/src/groups/router.test.ts → /home/satin/Work/palpitae/api/src/auth/jwt.ts
- `requestGroupMutation()` --calls--> `signJwt()`  [EXTRACTED]
  api/src/groups/router.test.ts → /home/satin/Work/palpitae/api/src/auth/jwt.ts

## Communities (77 total, 7 thin omitted)

### Community 0 - "Bracket UI Components"
Cohesion: 0.05
Nodes (79): base64UrlDecode(), base64UrlEncode(), buf, decoded, encoded, original, result, ALGORITHM (+71 more)

### Community 1 - "API Routers & Auth Middleware"
Cohesion: 0.06
Nodes (67): BracketColumn(), BracketColumnProps, ROUND_INDEX, column, { container }, renderColumn(), slot(), slots (+59 more)

### Community 2 - "Auth Encoding & Google OAuth"
Cohesion: 0.05
Nodes (54): ActiveRound, pollActiveMatches(), ActiveRow, db, [earliestOver, stillRelevant], matchdays, scoreMock, syncFixturesMock (+46 more)

### Community 3 - "Architecture Decision Records"
Cohesion: 0.07
Nodes (32): makeMatch(), defaultRoundIndex(), GroupMember, GroupPicksResponse, GroupPicksTab(), GroupPicksTabProps, MemberPrediction, GroupPicksResponse (+24 more)

### Community 4 - "Create Group Modal (legacy)"
Cohesion: 0.07
Nodes (44): API Football (External Provider), Cloudflare D1 (SQLite), Cloudflare Pages, Cloudflare Workers, Architecture Decision Records, Auth Domain Module, Competitions Domain Module, Groups Domain Module (+36 more)

### Community 5 - "Dashboard & Group Detail Pages"
Cohesion: 0.07
Nodes (26): ConfirmModalProps, Competition, CreatedGroup, CreateGroupModal(), CreateGroupModalProps, competitions, createdGroup, defaultProps (+18 more)

### Community 6 - "Predictions Tab (legacy)"
Cohesion: 0.05
Nodes (36): 🔐 Authentication, Backend (API), Competition, 📏 Constraints, 🧱 Core Product Concept, 🧠 Design Principles, ⚽ Domain Model, Excluded (future): (+28 more)

### Community 7 - "Bracket API Router"
Cohesion: 0.15
Nodes (28): buildAuthUrl(), exchangeCode(), generateNonce(), generatePkce(), generateState(), GoogleIdTokenClaims, GoogleUserInfo, JwksKey (+20 more)

### Community 8 - "App Entry & Login"
Cohesion: 0.12
Nodes (27): FEATURE_ALLOWLISTS, FEATURE_KEYS, FeatureFlags, FeatureKey, hasFeatureAccess(), body, candidate, competition_id (+19 more)

### Community 9 - "Match Card Component"
Cohesion: 0.13
Nodes (28): byMatch, groupId, importStatements, locked, match, matchId, matchIds, matchRows (+20 more)

### Community 10 - "Predictions Tab Component"
Cohesion: 0.1
Nodes (8): GroupDetail, GroupDetailPage(), GroupDetailPageProps, parseTab(), Tab, TAB_LABELS, TABS, User

### Community 11 - "Group Card (legacy)"
Cohesion: 0.11
Nodes (14): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, input, pastMatch, saveBtn (+6 more)

### Community 12 - "Group Card Component"
Cohesion: 0.11
Nodes (17): code:mermaid (erDiagram), code:sql (PRAGMA foreign_keys = ON;), `competitions`, Database Schema — Palpitae, Entities, Entity Relationship Diagram, `group_members`, `groups` (+9 more)

### Community 13 - "Fixture Sync (API Football)"
Cohesion: 0.11
Nodes (17): ✅ Alta Confiança, Anti-Abuse Strategy (MVP), ⚠️ Corrigido, ✅ In Scope, Key Assumptions to Validate, MVP Scope, Next Steps, Not Doing (and Why) (+9 more)

### Community 14 - "Create Group Modal"
Cohesion: 0.16
Nodes (11): app, cacheHeaderFor(), counter, createMatchesDbMock(), env, fakeEnv(), first, second (+3 more)

### Community 15 - "Button & Header (legacy)"
Cohesion: 0.24
Nodes (13): formatDate(), Match, MatchCard(), MatchCardProps, Prediction, awayInput, homeInput, input (+5 more)

### Community 16 - "Join Group Modal"
Cohesion: 0.12
Nodes (16): 🤖 AGENTS.md — Palpitae, ⚠️ Anti-Patterns (Avoid), 🏗️ Architecture Guidelines, 🧩 Code Guidelines, 🗄️ Database Rules, ⚽ Domain Rules (Critical), 🧠 General Principles, 🎯 Goal (+8 more)

### Community 17 - "Header Tests (legacy)"
Cohesion: 0.12
Nodes (16): A. Ativar e verificar o GA4 em produção *(ação do dono — sem código)*, ⏸️ Adiado por design — só fazer quando o gatilho existir, Analytics — GA4 com Consent Mode v2 + banner LGPD, Auditoria Lighthouse (mobile, build de prod) — 2026-06-19, B. Keyword research *(depende de tráfego acumular no Search Console)*, C. Bing Webmaster Tools *(ação do dono — sem código)*, context-seo.md — SEO, Performance & Analytics, Contexto do projeto (o que importa aqui) (+8 more)

### Community 18 - "Group Detail Page Tests (legacy)"
Cohesion: 0.12
Nodes (16): code:json ({), Componente `<Seo>` runtime — NÃO usar, context-improv.md — SEO Fine-Tuning (futuro), Core Web Vitals — monitoramento contínuo, Decisões tomadas (2026-06-19), Hreflang, Já implementado nesta rodada (saiu de "futuro" para "feito"), Keyword research (+8 more)

### Community 19 - "Group Detail Page (legacy)"
Cohesion: 0.12
Nodes (10): ButtonProps, onClick, HeaderProps, baseUser, link, onCreateGroup, onJoinGroup, onLogout (+2 more)

### Community 20 - "Modal (legacy)"
Cohesion: 0.14
Nodes (5): App(), AuthStatus, DashboardPage, GroupDetailPage, User

### Community 21 - "Card (legacy)"
Cohesion: 0.13
Nodes (9): GroupCardProps, GroupWithStats, baseGroup, onClick, DashboardPageProps, dialog, fetchSpy, user (+1 more)

### Community 22 - "Card Component"
Cohesion: 0.23
Nodes (8): GoogleLoginButton(), GoogleLogo(), Member, MembersTab(), MembersTabProps, buildApiUrl(), config, isAbsoluteUrl()

### Community 23 - "Modal Component"
Cohesion: 0.13
Nodes (8): JoinedGroup, JoinGroupModalProps, body, defaultProps, fetchSpy, joinedGroup, ModalProps, onClose

### Community 24 - "Team Badge Component"
Cohesion: 0.19
Nodes (8): Consent, getStoredConsent(), initGa(), setConsent(), Window, mockGetStoredConsent, mockSetConsent, rootEl

### Community 25 - "Dashboard Page Tests (legacy)"
Cohesion: 0.21
Nodes (5): GroupCard(), GroupCardProps, GroupWithStats, baseGroup, onClick

### Community 26 - "Button Component"
Cohesion: 0.15
Nodes (13): ADR-006: Frontend Stack — Vite + React (Static Site), Consequences, Consequences, Consequences, Consequences, Context, Context, Decision (+5 more)

### Community 27 - "Google Login Button"
Cohesion: 0.15
Nodes (12): 1. Analytics — medir tráfego ✅ IMPLEMENTADO (2026-06-19) — falta só o ID, 2. Auditoria Lighthouse — confirmar ganhos e pegar baseline ✅ FEITO (2026-06-19), 3. Keyword research (depende do item Off-page de Search Console), ADIADO POR DESIGN — só fazer quando o gatilho existir, context.md — SEO & Performance (backlog delegável), Contexto do projeto (o que importa para estas tarefas), Decisões descartadas — NÃO re-propor, Estado atual — JÁ FEITO (não refazer) (+4 more)

### Community 28 - "Brand SVG Assets"
Cohesion: 0.15
Nodes (13): Componente `<Seo>` runtime — NÃO usar, context-improv.md — SEO Fine-Tuning (futuro), Core Web Vitals — monitoramento contínuo, Decisões tomadas (2026-06-19), Hreflang, Já implementado nesta rodada (saiu de "futuro" para "feito"), Keyword research, Link building (+5 more)

### Community 29 - "Pages Function Proxy"
Cohesion: 0.15
Nodes (8): GroupDetail, GroupDetailPageProps, Tab, baseGroup, baseUser, fetchSpy, spy, User

### Community 30 - "Web App Entry"
Cohesion: 0.17
Nodes (3): CardProps, { container }, div

### Community 31 - "Icon SVG Assets"
Cohesion: 0.29
Nodes (8): baseGroup, baseUser, fetchSpy, input, mockGroupFetch(), renderPage(), spy, tabs

### Community 32 - "API Vitest Config"
Cohesion: 0.18
Nodes (10): 2. `StandingsTab.tsx` — componente principal, 3. `StandingsTab.test.tsx` — testes, 4. `index.ts` — barrel export, code:ts (const groupMatches = matches.filter((m) => m.group_name !== ), code:ts (interface TeamStanding {), code:ts (const [selectedGroup, setSelectedGroup] = useState<string | ), code:block13 ([Grupo A]                          ← header clicável → abre ), code:ts (export { default } from './StandingsTab') (+2 more)

### Community 33 - "Web Vite Config"
Cohesion: 0.2
Nodes (11): 1. `GroupDetailPage.tsx` — adicionar a aba, 2. Atualizar `web/src/pages/LoginPage/LoginPage.tsx`, 3. `api/src/index.ts` — exportar handler `scheduled`, 3. Atualizar `web/src/pages/LandingPage/LandingPage.tsx`, 4. Fallback `.at(-1)?.round` usa ordenação por `group_name`, não cronológica, 6. Criar `web/public/sitemap.xml`, 8. Corrigir CLS em `web/src/pages/LandingPage/LandingPage.tsx`, code:xml (<?xml version="1.0" encoding="UTF-8"?>) (+3 more)

### Community 34 - "Vite Env Types"
Cohesion: 0.2
Nodes (11): 1. `default_round: null/undefined` → mostra rodada 1 em vez da última, 2. Novo arquivo: `api/src/matches/poller.ts`, 2. Query de `default_round` ignora filtros `?round=X` / `?status=X`, 3. Duas queries D1 sequenciais por cache miss — usar `db.batch()`, 5. Atualizar `web/index.html`, 5. `makeMatch` e `mockFetch` desatualizados em `GroupPicksTab.test.tsx`, 7. Criar `web/public/robots.txt`, code:html (<!doctype html>) (+3 more)

### Community 35 - "Web Test Setup"
Cohesion: 0.2
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 36 - "Dashboard Page Barrel"
Cohesion: 0.2
Nodes (10): 1. Ajustar routing em `web/src/App.tsx`, Arquivos a criar, Arquivos tocados, code:json ({), Decisões, Janela de tempo, Objetivo, Próximos passos (após estabilizar o Cron) (+2 more)

### Community 37 - "Group Detail Page Barrel"
Cohesion: 0.2
Nodes (6): Competition, CreatedGroup, CreateGroupModalProps, competitions, createdGroup, defaultProps

### Community 38 - "Login Page Barrel"
Cohesion: 0.2
Nodes (9): Build Order, Current Status, Key rules encoded in schema, ~~Legacy SQL Draft~~, Next Steps, Open Decisions, Runtime Context, Schema (+1 more)

### Community 39 - "Bracket Tab Barrel"
Cohesion: 0.31
Nodes (4): BrowserFrame(), FeatureRow(), LandingPage(), ScoreCard()

### Community 40 - "Community 40"
Cohesion: 0.33
Nodes (5): DashboardPage(), DashboardPageProps, User, useDocumentTitle(), LoginPage()

### Community 41 - "Community 41"
Cohesion: 0.22
Nodes (9): ADR-007: Result Sync Strategy — Cron-Triggered Time-Window Poller, Alternatives Considered, code:block1 (First half:           45 min), code:sql (SELECT DISTINCT c.id AS comp_id, c.external_id, c.season, m.), Consequences, Consequences, Context, Decision (+1 more)

### Community 42 - "Community 42"
Cohesion: 0.22
Nodes (9): API externa, Arquivos novos a criar, Arquivos relevantes, context.md — Tarefa atual: Result Sync & Scoring, Cooldown / proteção de rate limit, Fluxo acordado, Leaderboard, Mudanças no schema (migração necessária) (+1 more)

### Community 43 - "Community 43"
Cohesion: 0.22
Nodes (9): 1. `api/wrangler.toml` — adicionar Cron Trigger, 2. `api/src/matches/poller.ts` (implementado), 3. `api/src/index.ts` — handler `scheduled` (implementado), 4. `api/src/matches/router.ts` — sem mudança, 4. `api/src/matches/router.ts` — sem mudança agora, 4. Criar `web/public/og-image.png`, Arquivos a modificar, code:bash (magick web/public/screenshots/grupos.png \) (+1 more)

### Community 44 - "Community 44"
Cohesion: 0.36
Nodes (4): Card(), CardProps, { container }, div

### Community 45 - "Community 45"
Cohesion: 0.36
Nodes (4): Modal(), ModalProps, onClose, renderModal()

### Community 46 - "Community 46"
Cohesion: 0.36
Nodes (4): TeamBadge(), TeamBadgeProps, { container }, img

### Community 47 - "Community 47"
Cohesion: 0.57
Nodes (5): env, fetchMatches(), loadDevVars(), main(), summarizeMatches()

### Community 48 - "Community 48"
Cohesion: 0.38
Nodes (3): Button(), ButtonProps, onClick

### Community 49 - "Community 49"
Cohesion: 0.29
Nodes (7): context-improv.md, context.md — SEO & Visibilidade no Google, Contexto técnico, Estado atual, Estado atual (original — pré-implementação), Status: implementado em 2026-06-19, Verificação pós-deploy

### Community 50 - "Community 50"
Cohesion: 0.29
Nodes (7): code:ts (export interface Match {), Convenções do projeto, Decisões tomadas, O que NÃO fazer, Status, Tarefa: Aba "Grupos" — Classificação da fase de grupos, Tipos relevantes já existentes

### Community 51 - "Community 51"
Cohesion: 0.48
Nodes (5): formatDate(), LeaderboardTab(), LeaderboardTabProps, Member, UserPrediction

### Community 52 - "Community 52"
Cohesion: 0.33
Nodes (5): ADR-001: Database Platform — Cloudflare D1, Architecture Decision Records, Consequences, Context, Decision

### Community 53 - "Community 53"
Cohesion: 0.53
Nodes (4): dialog, fetchSpy, mockResponse(), user

### Community 55 - "Community 55"
Cohesion: 0.4
Nodes (3): Overview, System Architecture — Palpitae, Working with Architecture

### Community 56 - "Community 56"
Cohesion: 0.4
Nodes (5): ADR-005: Authentication — Direct Google OAuth 2.0, Consequences, Context, Decision, Security Requirements

### Community 57 - "Community 57"
Cohesion: 0.4
Nodes (5): ADR-002: Migration Strategy — Wrangler D1 Migrations, Consequences, Context, Decision, Rules

### Community 58 - "Community 58"
Cohesion: 0.5
Nodes (4): ADR-008: Caching Strategy for `GET /matches` — Content-Derived TTL + Edge Cache API, Consequences, Context, Decision

### Community 59 - "Community 59"
Cohesion: 0.5
Nodes (4): ADR-003: API Runtime — Cloudflare Workers + Hono, Consequences, Context, Decision

### Community 60 - "Community 60"
Cohesion: 0.5
Nodes (4): ADR-004: Prediction Locking — Derived at Runtime, Consequences, Context, Decision

### Community 63 - "Community 63"
Cohesion: 0.67
Nodes (3): Logo 2 SVG, Logo SVG (Logo.svg), Logo Text SVG

## Knowledge Gaps
- **312 isolated node(s):** `app`, `{ db, updateRun }`, `syncFixturesMock`, `scoreMock`, `ActiveRow` (+307 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `config` connect `Card Component` to `API Routers & Auth Middleware`, `Architecture Decision Records`, `Dashboard & Group Detail Pages`, `Group Detail Page Barrel`, `Community 40`, `Predictions Tab Component`, `Group Card (legacy)`, `Button & Header (legacy)`, `Community 51`, `Modal (legacy)`, `Community 53`, `Card (legacy)`, `Modal Component`, `Team Badge Component`, `Pages Function Proxy`, `Web App Entry`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Why does `AppContext` connect `Bracket UI Components` to `Auth Encoding & Google OAuth`, `Bracket API Router`, `App Entry & Login`, `Match Card Component`, `Create Group Modal`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `app`, `{ db, updateRun }`, `syncFixturesMock` to the rest of the system?**
  _312 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bracket UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `API Routers & Auth Middleware` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Auth Encoding & Google OAuth` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Architecture Decision Records` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._