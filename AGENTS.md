# 🤖 AGENTS.md — Palpitae

## 🎯 Purpose

This file defines how AI agents should operate within this repository, and captures **architectural intent**.

The goal is to ensure:

- Consistency
- Correctness
- Alignment with the product domain

**Note:** This file describes _intent_ and _governance_. For the **current state** of the codebase (modules, dependencies, god nodes), see [`graphify-out/GRAPH_REPORT.md`](graphify-out/GRAPH_REPORT.md) — it's auto-generated from source and always in sync.

**Tarefa atual:** SEMPRE leia [`context.md`](context.md) para entender o que está sendo implementado no momento antes de ler código ou tomar decisões de implementação.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- ALWAYS read graphify-out/GRAPH_REPORT.md before reading any source files, running grep/glob searches, or answering codebase questions. The graph is your primary map of the codebase.
- IF graphify-out/wiki/index.md EXISTS, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

---

## 📚 Source of Truth

Before implementing anything, ALWAYS read:

- `./docs/product/vision.md` → product rules and domain
- `./docs/architecture/decisions.md` → architectural decisions (ADR)
- `./docs/runtime/context.md` → current working context (may be incomplete)

If there is a conflict:

1. `vision.md` wins
2. then `decisions.md`
3. then `context.md`

---

## 🧠 General Principles

- Do NOT invent business rules
- Do NOT assume missing requirements
- Ask for clarification if something is ambiguous
- Prefer explicitness over magic
- Keep implementations simple and predictable

---

## 🏗️ Architecture Guidelines

- Backend is a modular monolith (initially)

- Use clear domain boundaries:
  - auth
  - competitions
  - matches
  - groups
  - predictions
  - leaderboard
  - payments

- Avoid tight coupling between modules

- Use services/use-cases instead of fat controllers

---

## 🗄️ Database Rules

- Use **Cloudflare D1 (SQLite)** — see ADR-001 in `docs/architecture/decisions.md`

- All IDs are `TEXT` (UUID generated via `crypto.randomUUID()` in the app layer)

- All timestamps are `TEXT` in ISO 8601 UTC format

- Always define:
  - primary keys
  - foreign keys
  - indexes for frequent queries

- Never duplicate data unless explicitly required

- Be explicit about constraints (e.g., unique, not null, check)

---

## 🔄 Idempotency & Sync

- External data sync MUST be idempotent
- Never assume events are unique
- Updates must not create duplicates
- Recalculate derived data only when necessary

---

## ⚽ Domain Rules (Critical)

- A prediction can be edited ONLY before match start time

- After match start → prediction is locked

- One prediction per user per match per group

- Scoring:
  - exact score → 3 points
  - correct outcome → 1 point
  - otherwise → 0

- Ranking tie-breakers:
  1. total points
  2. exact score hits
  3. prediction lock timestamp (earlier wins)

---

## 📊 Analytics — GA Events (obrigatório)

Ao adicionar ou modificar um elemento clicável (`button`, `Link`, `a`, ou qualquer elemento
com `onClick`), adicione `trackEvent('click_<contexto>_<acao>')` (`web/src/analytics/ga.ts`).
Contexto em inglês, ação em português. NÃO rastreie steppers de placar nem fechar modal por
backdrop/ESC.

Convenções de nome, params, o que ignorar e eventos já mapeados:
[`docs/analytics.md`](docs/analytics.md).

---

## 📡 Observability — Server-Side Events (obrigatório)

Ao **criar ou modificar um endpoint que faz mutação de negócio** (cria/edita/remove estado:
palpite, grupo, membro, login...), adicione `logEvent(c.env.AE, '<tipo>', { ... })` após a
escrita — equivalente server-side do `trackEvent()`. Pseudonimize PII com `hashUserId()`
(LGPD). NÃO instrumente leituras (`GET`) nem cliques (cliques = GA no cliente).

Convenções, esquema de eventos, arquitetura e decisões descartadas:
[`docs/observability.md`](docs/observability.md).

---

## 🧩 Code Guidelines

- Prefer small, composable functions

- Avoid premature abstractions

- Avoid over-engineering

- Name things clearly:
  - `createGroup`
  - `submitPrediction`
  - `recalculateLeaderboard`

- Do not introduce unnecessary libraries

---

## 🧪 Testing

- Write tests for:
  - scoring logic
  - ranking logic
  - prediction locking

- Prefer deterministic tests

- Mock external providers

---

## ⚠️ Anti-Patterns (Avoid)

- Hidden business rules inside controllers
- Duplicated logic across modules
- Implicit side effects
- Time-based logic without clear boundaries

---

## 🔁 Updating Context

- DO NOT modify `vision.md` directly

- You MAY suggest updates to it

- You MAY update:
  - `context.md` (runtime notes)
  - `decisions.md` (via ADR format)

---

## 🚀 Workflow

When implementing a feature:

1. Read relevant docs
2. Identify domain entities involved
3. Define database changes (if needed)
4. Implement use-case/service
5. Add validations (especially time-based rules)
6. Write tests
7. Update `context.md` if needed

---

## 🧭 If Unsure

- Ask for clarification
- Do not guess

---

## 🎯 Goal

Produce clean, maintainable, and domain-aligned code that faithfully implements the Palpitae product.
