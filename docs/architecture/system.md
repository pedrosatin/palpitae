# System Architecture — Palpitae

## Overview

For **current architecture structure** (modules, god nodes, dependencies, communities):
→ See [`graphify-out/GRAPH_REPORT.md`](../../graphify-out/GRAPH_REPORT.md) — automatically generated from source code.

For **architectural intent** (why we chose certain tech, module boundaries, constraints):
→ See [`AGENTS.md`](../../AGENTS.md) and [`docs/architecture/decisions.md`](decisions.md) — the governance layer.

For **product rules** (scoring, prediction locking, domain constraints):
→ See [`docs/product/vision.md`](../product/vision.md) — source of truth.

---

## Working with Architecture

1. **To understand current state:** Run `graphify update .` then read the generated report.
2. **To check for drift:** Run graphify and compare against AGENTS.md intent — if they conflict, something needs refactoring.
3. **To make a change:** Update the relevant intent doc (AGENTS.md, decisions.md, or vision.md) *first*, then implement.
