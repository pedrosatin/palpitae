# 🤖 AGENTS.md — Palpitae

## 🎯 Purpose

This file defines how AI agents should operate within this repository.

The goal is to ensure:

- Consistency
- Correctness
- Alignment with the product domain

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
