# Migração bolao-brasileirao → Palpitae

> Tarefa ativa: migrar o histórico do projeto `bolao-brasileirao` (repo irmão em
> `~/Work/personal/bolao-brasileirao`) para o Palpitae e adicionar o Brasileirão
> Série A 2026 como competição, com o mesmo sync/regras da Copa do Mundo.

Análise completa e plano por fases: [`docs/bolao-migration/analysis.md`](docs/bolao-migration/analysis.md).
Leia antes de qualquer passo — contém o de-para de usuários, validações já feitas em
produção e os pontos de atenção.

## Estado

- [x] Análise de viabilidade (2026-07-12) — aprovada pelo dono
- [x] Fase 1 — Competição seedada em prod (`06baa1de-…`, slug `campeonato-brasileiro-serie-a-2026`).
      Times/jogos virão do cron de discovery (06h UTC diário) — conferir com `sql/05-validate.sql`.
- [x] Fase 2 — Grupo "Bolão Brasileirão" + 6 membros criados em prod (verificado: 6 membros, 3/1/0/hidden)
- [x] Fase 1b — Seed manual de 20 times + 380 jogos (`sql/01b-seed-teams-matches.sql`,
      aprovado pelo dono; upsert compatível com o cron, que reconcilia diariamente)
- [x] Fase 3 — 773/773 predictions importadas (todo api_match_id resolveu)
- [x] Fase 4 — Leaderboard recalculado e VALIDADO em prod: WEEGEE 106, Chu 98, satin 88,
      Isa 61, PDR 54, FABRE 42 — todos exatos; 0 inconsistências leaderboard×predictions.
      Nota: 21 jogos terminaram depois do último sync do bolão; o cron de discovery vai
      pontuá-los (scored_at NULL) e os totais vão subir — comportamento correto.
- [ ] Fase 5 — Cutover: grupo assume rodadas futuras; bolão antigo aposentado

IDs fixos: competição `06baa1de-01c3-4e71-ac6e-a850fa690ec1` · grupo `d79438a7-a324-48d0-a245-950aff4d5849` · invite `69TL-RH2U`

## Regras da tarefa

- **Toda escrita no D1 de produção exige aprovação explícita do dono antes.** Leituras ok.
- Histórico mantém os pontos como o bolão calculou (regras são idênticas — validado:
  0 divergências em 773 palpites). Rodadas futuras usam o fluxo normal do Palpitae.
- WEEGEE e WEEGGE são o mesmo jogador (gustavokl1996@gmail.com) — fundir na importação.
- Nenhuma mudança de schema é necessária; não criar migrations sem justificar.
- Branch: `bolao-migration` (worktree em `.claude/worktrees/bolao-migration`, base main).
