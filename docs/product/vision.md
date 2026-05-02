# 🧠 Palpitae — Product Vision

> **⚠️ REFINED (April 2026):** See `docs/ideas/palpitae-refined.md` for the latest ideation session. This document now serves as legacy context for reference.

---

## 📌 Overview

Palpitae is a SaaS platform for managing private football prediction groups ("bolões"). Users can create groups, invite others, submit match predictions, and compete in rankings based on accuracy.

The system supports multiple football competitions (e.g., Brasileirão, Libertadores, Copa do Mundo) and is designed to be scalable, modular, and provider-agnostic.

**Current Status:** MVP in production at `bolao.pedrosatin.com` (Brasileirão). Palpitae is a componentized refactor with multi-competition support, multi-provider data sync, and anti-abuse strategy.

---

## 🧱 Core Product Concept

At its core, Palpitae is:

> A system for managing private competitions based on predictions of real-world events (football matches), with dynamic ranking and scoring.

---

## 🏗️ High-Level Architecture

### Backend (API)

- Centralized service
- Responsible for:
  - Authentication
  - Group management
  - Predictions
  - Ranking calculation
  - Payment validation
  - Sync with external football data providers

### Frontend

- Multiple apps (one per competition)
- Example:
  - `brasileirao.palpitae.com.br`
  - `libertadores.palpitae.com.br`

- Shared component library (design system)
- Each app has its own theme/branding

### Workers / Background Jobs

- Sync matches and results from external APIs
- Recalculate rankings when matches finish
- Handle delayed/rescheduled matches

---

## 🔐 Authentication

- Social login only (Google initially)
- Only required user data:
  - email (unique)

- Optional:
  - nickname (per user or per group)

Auth should be handled by a third-party provider (e.g., Firebase Auth or Supabase Auth).

---

## ⚽ Domain Model

### Competition

Represents a real-world tournament (Brasileirão, Libertadores, etc.)

### Team

Represents a football team

- Includes logo URL

### Match

Represents a game between two teams

- Has start time, score, and status
- Belongs to a competition
- Has a phase (group stage, knockout, etc.)

---

### Group

A private competition created by a user

- Only the creator (admin) pays
- Minimum 5 users required
- Maximum 50 users allowed
- Users join via public invite link
- Admin can remove users

---

### Prediction

A user's guess for a specific match within a group

- Includes predicted score
- Can be edited **until the match starts**
- Becomes locked after match start

---

### Leaderboard

Ranking of users within a group

- Based on accumulated points
- Updated when matches finish

---

## 🧮 Scoring System

Default rules:

- Exact score → 3 points
- Correct outcome (win/draw/loss) → 1 point
- Wrong prediction → 0 points

### Future support:

- Phase-based weight (e.g., finals worth more points)

---

## 🏆 Ranking Rules

Ranking is determined by:

1. Total points
2. Number of exact score predictions
3. Prediction lock timestamp (earlier wins)

---

## ⏱️ Prediction Locking

- Predictions can be edited until `match.start_time`
- After that, they are locked
- Lock enforcement must happen on backend

---

## 🔄 Match Sync & Idempotency

The system depends on external APIs for match data.

Requirements:

- Must support changing providers without breaking the system
- Must handle:
  - duplicate updates
  - score corrections
  - match rescheduling

### Rules:

- Matches are identified by `external_id + provider`
- Updates must be idempotent (same input → no duplicated effects)
- Ranking recalculation should only happen when:
  - match status changes to `finished`
  - OR score changes

---

## 🔁 Rescheduled Matches

- If a match is rescheduled **before it starts**, predictions remain editable
- If already started, predictions stay locked
- System must sync match start time periodically

---

## 💰 Monetization

- Only group admin pays
- Payment unlocks group functionality
- Payment is required before inviting users

---

## 📊 Leaderboard Strategy

Leaderboards are **materialized (stored)**, not calculated on the fly.

They are updated when:

- Match results are finalized
- Scores change

---

## 🔗 Invitations

- Public invite link using a unique code
- No email whitelist required (MVP)
- Admin can remove users at any time

---

## 📏 Constraints

- Group size: min 5, max 50 users
- One prediction per user per match per group
- All timestamps stored in UTC

---

## 🧠 Design Principles

- Provider-agnostic external data layer
- Idempotent data synchronization
- Strong backend validation (never trust frontend)
- Event-driven updates (match result → ranking update)
- Modular and extensible domain model

---

## 🚀 MVP Scope

### Included:

- Google login
- One competition (Brasileirão)
- Group creation
- Invite via link
- Prediction submission/editing
- Ranking system
- Basic payment handling

### Excluded (future):

- Multiple competitions simultaneously
- Custom scoring rules
- Notifications (email/push)
- Advanced analytics

---

## ⚠️ Important Edge Cases

- Match score changes after initial result
- Duplicate sync events from provider
- Users not submitting predictions
- Tie-breaking in rankings
- Group with inactive users
- Match time changes close to kickoff

---

## 📌 Future Extensions

- Global rankings across groups
- Prediction statistics per user
- Notifications (email, push, WhatsApp)
- AI-based prediction suggestions
- Public competitions with prizes

---

## 🧩 Technical Notes

- Prefer PostgreSQL
- Use background jobs for sync and ranking updates
- Use a clean architecture (domain-driven or modular monolith)

## 🎯 Goal

Build a scalable, fun, and competitive platform that enhances the social experience of watching football through prediction-based games.

---

## 🔄 Refinement Strategy (MVP → V2)

See `docs/ideas/palpitae-refined.md` for complete ideation output including:

- **Recommended Direction:** Componentized groups with multi-provider adapter pattern
- **Key Assumptions:** Socials > betting (validated), weekly engagement (not daily), anti-abuse strategy
- **MVP Scope:** Copa 2026 + Brasileirão 2026, refactor from `bolao.pedrosatin.com`
- **Roadmap:** Sprint 0-8 for MVP, Q3/Q4 2026 for multi-competition, V2 for public tournaments
- **Open Questions:** Provider selection, reschedule handling, pricing finalization, timeline

---

## 📚 Legacy Content Below

Everything below is from pre-refinement analysis. Kept for reference but superseded by `docs/ideas/palpitae-refined.md`.
