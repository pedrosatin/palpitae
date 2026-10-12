# Instruções para agentes

## Arquitetura e Ponteiros

- **API backend**: `api/` — Cloudflare Worker (Hono + D1 SQLite + Vitest).
- **Frontend web**: `web/` — React 19 + Vite SPA (SSR prerender + Vitest + Playwright).
- **Documentação de domínio**: `docs/` (`architecture/`, `security.md`, `observability.md`).
- **Grafo de conhecimento**: `graphify-out/GRAPH_REPORT.md`.

## Comandos canônicos

```bash
# Na raiz:
npm run check        # Executa lint (oxlint), typecheck (tsc) e testes (api + web)
npm run lint         # oxlint api web
npm run typecheck    # tsc api + web
npm test             # vitest em api/ e web/

# Desenvolvimento e testes isolados:
npm --prefix api test
npm --prefix web test
```

## Agent skills

### Issue tracker
Local tracking in Markdown files under `.scratch/<feature>/`.
Interactive dashboard at `.scratch/index.html`.
See `docs/agents/issue-tracker.md`.

### Domain docs
Single-context convention (`docs/`). See `docs/agents/domain.md`.
