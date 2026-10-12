# Domain docs: single-context

This repository follows a single-context domain documentation layout.

## Layout

- `CONTEXT.md` (or `AGENTS.md` / `CLAUDE.md`) at the repository root contains the core rules, architecture overview, and conventions.
- Architectural Decision Records (ADRs) live in `docs/adr/` as numbered markdown files (e.g. `docs/adr/0001-use-postgres.md`).
- Domain glossary and core entity definitions should be referenced consistently across specs, tickets, and code.

## Consumer rules

- Any spec created by `to-spec` must respect the ADRs in `docs/adr/` and use the domain vocabulary.
- Any ticket created by `to-tickets` must respect existing architecture decisions.
- When an agent makes a non-trivial architectural choice, it should propose recording an ADR in `docs/adr/`.
