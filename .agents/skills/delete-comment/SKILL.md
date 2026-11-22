---
name: delete-comment
description: >-
  Limpa comentários do codebase palpitae (tautology/stale/excuse/decision),
  atualiza ADRs e tickets locais, e aperta o ratchet `comments-baseline.json`.
  Use em /delete-comment, "apaga comentários", "ratchet de comentários",
  "proíbe comentários", ou ao repetir a limpeza depois do baseline.
---

# delete-comment

Roda a limpeza de comentários no escopo versionado de `api/` e `web/` (TS/TSX/JS/MJS/CSS/SQL de migração e configs de código como `wrangler.toml` / `vite.config.*`). Fora: `node_modules`, `dist`, `graphify-out`, gerados, vendorizados e Markdown.

## Exceções (ficam no código)

Não apague e o checker não conta:

- cabeçalho de licença
- shebang
- diretivas de ferramenta (`// @ts-*`, `eslint-disable` / `oxlint-disable`, `prettier-ignore`, `/// <reference>`)
- JSDoc de contrato de API pública (`/**` imediatamente antes de `export`, ou com `@param` / `@returns` / `@throws` / `@deprecated` / `@see`)

## Categorias e ações

Para cada comentário banível:

| Categoria | Teste | Ação |
| --- | --- | --- |
| Tautology | só repete o que o código já mostra | apagar |
| Stale | fala de código ou desenho que não existe mais | apagar |
| Excuse | justifica gambiarra / hack | apagar + ticket local |
| Decision Record | decisão importante e não óbvia | mover para ADR (ou apagar se a ADR já cobre) |

Divisores de seção (`// ---`, `/* ─── */`) e narração de teste (“Mock X”, “Should fail”) são tautology.

## Passos

1. **Inventário.** Na raiz do checkout da branch de limpeza:
   `node scripts/comments-check.mjs --dump /tmp/palpitae-comments.json`
2. **Classificar e editar.** Percorra os comentários sem `exception` no dump. Apague tautology/stale/excuse. Só comentários; comportamento intacto.
3. **Excuse → ticket.** Worktree principal:
   `git worktree list --porcelain | awk '/^worktree / { print $2; exit }'`
   Grave em `<primary>/.scratch/no-comments-YYYY-MM/issues/NN-<slug>.md` com `Status: needs-triage`, `arquivo:linha`, o texto original e o que corrigir. Mesmo tipo de gambiarra → um ticket. Atualize ou crie `<primary>/.scratch/no-comments-YYYY-MM/spec.md`. `.scratch/` não entra em commit.
4. **Decision → ADR.** Decisões ficam em [`docs/architecture/decisions.md`](../../../docs/architecture/decisions.md). Relacionadas no mesmo ADR; se a decisão já está lá, só apague o comentário. Próximo número livre depois do último `ADR-NNN` do arquivo.
5. **Ratchet.** `node scripts/comments-check.mjs --update` regrava `comments-baseline.json` **só para baixo**. Arquivo novo com comentários ou contagem acima do baseline falha no check.
6. **Validar.** `npm run check`, build do web, e o próprio `comments-check` (já ligado em `npm run lint` / `npm run check`).
7. **Publicar.** Commits em português, sem trailer de IA; PR draft contra `main` quando a rodada for de entrega. Skill `publication-hygiene` antes do push/PR.

## Checker

- Script: `scripts/comments-check.mjs`
- Baseline: `comments-baseline.json` (versionado)
- Flags: `--update`, `--dump <path>`, `--check` (junto com dump)
- Ligação: `npm run lint` e `npm run check` na raiz

## Critério de pronto

- Tautology/stale óbvios desta passagem apagados
- Excuses com ticket no scratch do primary; decisions na ADR ou já cobertas
- `comments-check` verde com baseline ≤ ao da passagem anterior
- Contagem do relatório: removidas nesta PR + restantes no baseline = estimativa total a eliminar
- Testes/typecheck/lint verdes (ou falha pré-existente em `origin/main` documentada)
