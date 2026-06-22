## Observabilidade — eventos server-side (obrigatório)

**Ao criar ou modificar um endpoint que faz mutação de negócio** (cria/edita/remove
estado: palpite, grupo, membro, login...), adicione um `logEvent(c.env.AE, '<tipo>', { ... })`
após a escrita — equivalente server-side do `trackEvent()`. Pseudonimize PII com
`hashUserId()` (LGPD). Não instrumente leituras (`GET`) nem cliques (cliques = GA no cliente).

Arquitetura, esquema de eventos, convenções e decisões descartadas:
[`docs/observability.md`](docs/observability.md). Leia antes de mexer em logs/métricas/eventos.

## Analytics — eventos de clique (obrigatório)

**Ao adicionar ou modificar um elemento clicável** (`button`, `Link`, `a`, ou qualquer
elemento com `onClick`), adicione um `trackEvent('click_<contexto>_<acao>')` correspondente
(`web/src/analytics/ga.ts`). Contexto em inglês, ação em português. Não rastreie steppers de
placar nem fechamento de modal por backdrop/ESC.

Convenções de nome, params, o que ignorar e eventos já mapeados:
[`docs/analytics.md`](docs/analytics.md).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- ALWAYS read graphify-out/GRAPH_REPORT.md before reading any source files, running grep/glob searches, or answering codebase questions. The graph is your primary map of the codebase.
- IF graphify-out/wiki/index.md EXISTS, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
