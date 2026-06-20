## SEO, Performance & Analytics

O trabalho de SEO/performance/analytics está documentado em
[`context-seo.md`](context-seo.md): o que já foi feito, o que falta e as decisões
descartadas. Leia antes de mexer em qualquer coisa desses tópicos.

## Analytics — regra obrigatória para eventos de clique

**Sempre que adicionar ou modificar um elemento clicável** (button, Link, a, ou qualquer elemento com `onClick`), adicione um `trackEvent()` correspondente.

```ts
import { trackEvent } from '../../analytics/ga'

// botão
<button onClick={() => { trackEvent('click_<contexto>_<acao>'); doSomething() }}>

// link
<Link to="/rota" onClick={() => trackEvent('click_<contexto>_<acao>')}>
```

**Convenções de nome:**
- snake_case, prefixo `click_` para cliques, `submit_` para envios de formulário bem-sucedidos
- padrão: `click_<página/componente>_<ação>` — ex: `click_header_logout`, `click_grupo_tab`
- inclua params quando útil para segmentação: `{ tab }`, `{ group_id }`, `{ round }`, `{ count }`

**O que rastrear vs. ignorar:**
- Rastrear: toda ação intencional do usuário (navegar, abrir modal, salvar, copiar, confirmar)
- Ignorar: steppers de placar (−/+ no MatchCard) — volume alto, baixo valor analítico
- Ignorar: fechamento de modal via backdrop/ESC (ruído sem intenção clara)

**Onde está tudo:**
- Helper: `web/src/analytics/ga.ts` → `trackEvent(name, params?)`
- Eventos já mapeados: ver tabela no commit de instrumentação (2026-06-19)

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- ALWAYS read graphify-out/GRAPH_REPORT.md before reading any source files, running grep/glob searches, or answering codebase questions. The graph is your primary map of the codebase.
- IF graphify-out/wiki/index.md EXISTS, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
