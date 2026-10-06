# Migração bolao-brasileirao → Palpitae

> Data: 2026-07-12 · Status: **executada e validada em produção** (ver [Execução](#execução-2026-07-12))
> Decisão registrada em [ADR-011](../architecture/decisions.md).
> Fontes: código dos dois repositórios + consultas aos D1 de produção
> (`bolao-brasileirao` `28b1c613…`, `palpitae` `ffd7a7ed…`).

## Execução (2026-07-12)

Todas as fases de dados aplicadas em prod via `wrangler d1 execute --remote` com os SQLs
de [`sql/`](sql/) (idempotentes; ordem 01 → 01b → 02 → 03 → 04; validação: 05).

Os SQLs versionados usam placeholders (`<GROUP_ID>`, `<USER_ID_*>`, `<INVITE_CODE>`)
no lugar dos IDs de produção e do código de convite. O dump de palpites do bolão e o
`sql/03-import-predictions.sql` gerado a partir dele têm dados pessoais e não são
versionados; `bolao-predictions-export.example.json` mostra o formato com dados
sintéticos.

| Fase | Resultado |
|---|---|
| 01 — competição | `06baa1de-01c3-4e71-ac6e-a850fa690ec1`, slug `campeonato-brasileiro-serie-a-2026` |
| 01b — times/jogos | 20 times, 380 jogos (seed manual; cron de discovery reconcilia por cima) |
| 02 — grupo | "Bolão Brasileirão" (`<GROUP_ID>`), 6 membros, 3/1/0/`hidden`, convite `<INVITE_CODE>` |
| 03 — palpites | 773/773 importados (todo `api_match_id` resolveu) |
| 04/05 — leaderboard | Idêntico ao bolão: E 106 · B 98 · A 88 · F 61 · D 54 · C 42; 0 inconsistências |

Nota pós-execução: ~21 jogos terminaram depois do último sync do bolão; o cron pontua
esses palpites (`scored_at IS NULL`) e os totais sobem — comportamento correto.
Pendente (fora do banco): comunicar o grupo (trava agora é por jogo, não por rodada) e
aposentar o bolao-brasileirao.

---

O restante deste documento é a análise de viabilidade que fundamentou a execução.

## Veredicto

**Viável, risco baixo.** Mesmo provider de dados, mesma competição, regras de pontuação
idênticas (provado nos dados de produção), todos os usuários já existem no Palpitae e a
infra do Palpitae já é genérica por competição. A migração é essencialmente transformação
de dados + um seed inicial de competição — sem mudança estrutural de schema.

## Objetivo (intenção confirmada com o usuário)

- Palpitae vira o único app: Brasileirão Série A 2026 adicionado como competição, com o
  mesmo sync/regras da Copa do Mundo.
- Histórico do bolao-brasileirao (rodadas, palpites, pontuação) importado para um grupo
  compartilhado com os 6 jogadores, classificação preservada.
- Rodadas futuras palpitadas e sincronizadas só no Palpitae; bolão antigo aposentado.
- Histórico mantém pontos como o bolão calculou; futuro usa a regra do Palpitae.

## Fatos verificados

### 1. Mesmo provider, mesma competição

| | bolao-brasileirao | palpitae |
|---|---|---|
| Provider | football-data.org v4 | football-data.org v4 |
| Competição | `FOOTBALL_DATA_COMPETITION_ID=2013` (BSA) | `competitions.external_id` por linha |
| ID de partida | `matches.api_match_id` | `matches.external_id` (`provider='football-data'`) |

`api_match_id` e `external_id` compartilham o mesmo espaço de IDs → mapeamento de
partidas é join direto, sem heurística de nome/data.

### 2. Regras de pontuação idênticas (validado em produção)

- Bolão (`apps/worker/src/scoring.ts`): 3 exato / 1 resultado (incl. empate) / 0.
- Palpitae (`api/src/matches/scoring.ts`): mesma regra com defaults `points_exact=3`,
  `points_winner=1`; mesma semântica de empate.
- **Validação:** recálculo SQL dos 773 palpites de prod do bolão contra a regra →
  **0 divergências**. `scores.points_total` vs `SUM(predictions.points)` por
  rodada/participante → **0 inconsistências**.
- Consequência: "manter pontuação antiga" e "recalcular pela regra do Palpitae" produzem
  o mesmo número. Um re-score acidental no Palpitae não altera a classificação.

### 3. Usuários — todos existem no prod do Palpitae

Cada `participant_name` do bolão foi ligado a um `users.id` do Palpitae pelo e-mail
da conta. O de-para real (apelidos, e-mails e IDs) fica fora do repositório, no
arquivo local `bolao-user-map.json` lido por `generate-import.mjs`. Aqui os
jogadores aparecem como A a F:

| Bolão (`participant_name`) | Palpitae `users.id` |
|---|---|
| Jogador A (dono do grupo) | `<USER_ID_A>` |
| Jogador B | `<USER_ID_B>` |
| Jogador C | `<USER_ID_C>` |
| Jogador D | `<USER_ID_D>` |
| Jogador E (duas grafias do apelido) | `<USER_ID_E>` |
| Jogador F | `<USER_ID_F>` |

As duas grafias do Jogador E são o mesmo jogador: **0 partidas em comum** entre as
duas → fusão segura (145+10 = 155 palpites, 103+3 = 106 pts).

### 4. Volume no prod do bolão (2026-07-12)

- 18 rodadas (3–20), temporada 2026.
- 180 partidas: 156 FINISHED, 3 POSTPONED, 10 SCHEDULED, 11 TIMED.
- 773 predictions, 79 linhas em scores.

### 5. Infra do Palpitae já é genérica por competição

- `syncFixtures` (api/src/matches/sync.ts): upsert de competição/times/partidas por
  `competitionCode` — funciona com `BSA`.
- Fixture discovery (cron diário 06h UTC) e result poller (cron 0,30min) selecionam
  competições por `provider='football-data' AND status != 'finished'` — BSA entra
  automaticamente depois de existir na tabela.
- Criação de grupo valida qualquer `competition_id` existente.
- `roundLabel()` já formata rodada numérica → "Rodada N" (liga tem 38).
- Tab "Tabela" (StandingsTab) calcula classificação de liga a partir das partidas.
- `penalty_phases` default `'[]'` = fail-closed → liga nunca pede palpite de pênalti. Correto.
- Nenhum hardcode de Copa no front (só copy da LandingPage).

## Mapeamento de dados

```
bolao.predictions ──┐
  participant_name ─┼→ palpitae.predictions.user_id      (tabela de de-para acima)
  match_id → bolao.matches.api_match_id
             = palpitae.matches.external_id ─→ match_id  (após seed do BSA)
  pred_home/away_score ─→ predicted_home/away_score
  points ─→ points_awarded                               (cópia; recálculo daria igual)
  (novo) group_id ─→ grupo criado na Fase 2
  created_at/updated_at ─→ preservados
  penalty_points = 0, predicted_penalty_winner = NULL
```

`bolao.scores` não migra como tabela — o leaderboard do Palpitae é derivado de
predictions (`recalculateLeaderboard`). Serve só como fonte de validação.

## Plano de execução (fases; cada escrita em prod exige aprovação)

1. **Seed do BSA** — rodar `syncFixtures({ competitionCode: 'BSA', season: 2026 })` uma
   vez contra o D1 de prod (script one-off ou endpoint admin temporário — o cron de
   discovery não cria competição nova, só atualiza existentes). Resultado: competição
   `campeonato-brasileiro-serie-a-2026`, ~20 times, 380 partidas. Crons assumem daí em diante.
2. **Grupo** — criar grupo (nome a definir com o dono) com `points_exact=3`,
   `points_winner=1`, `points_penalty=0`, dono Jogador A; inserir os 6 `group_members`.
   Decidir `predictions_visibility` (`public` replica o comportamento do bolão antigo).
3. **Importar palpites** — script gera SQL com as 773 predictions (mapeamento acima),
   aplicado via `wrangler d1 execute --remote --file`. Palpites de jogos futuros entram
   com `points_awarded=0` e serão pontuados pelo poller normalmente.
4. **Leaderboard + validação** — rodar recálculo do grupo (mesma query de
   `recalculateLeaderboard`) e conferir totais esperados:
   B 98 · A 88 (E 106 fundido) · F 61 · D 54 · C 42
   (ordem final: E 106, B 98, A 88, F 61, D 54, C 42).
   Spot-check de uma rodada inteira contra a UI do bolão.
5. **Cutover** — grupo passa a ser usado nas próximas rodadas; bolão antigo vira
   read-only e depois é desligado (fora de escopo desta fase).

## Pontos de atenção (nenhum bloqueante)

- **Trava de palpite muda:** bolão trava a rodada inteira em `rounds.cutoff_at`;
  Palpitae trava por jogo no `start_time` (ADR-004). Mais permissivo — comunicar ao grupo.
- **Ranking por rodada:** bolão tem pontuação por rodada; Palpitae mostra total
  acumulado + exact_hits. Dados migrados permitem derivar por rodada; view é feature
  futura se o grupo sentir falta.
- **Ordem de import vs score:** importar predictions com pontos copiados e rodar recalc
  manual (Fase 4). Jogos finished já terão `scored_at` setado pelo seed/poller, então o
  `scoreUnprocessedMatches` não sobrescreve o histórico — e se sobrescrevesse, daria o
  mesmo número (regras idênticas).
- Rodadas 1–2 aparecem sem palpites (bolão começou na rodada 3) — cosmético.
- ~~3 jogos POSTPONED viram `scheduled` no Palpitae (mapStatus) — ok, poller resolve.~~
  **Errado — corrigido em 2026-08-01 (ADR-013).** O poller não resolve: a janela dele
  (`now-200min … now-115min`) passa uma vez e nunca mais olha. O jogo ficava `scheduled`
  num horário já vencido, com o palpite travado para sempre. Hoje existe a flag
  `matches.postponed` (migration 0013).
- Verificar se `groups.payment_status='pending'` bloqueia algum fluxo (crença: não, MVP).
- Times de clube não estão em `TEAM_TRANSLATIONS` — caem no nome/TLA da API (aceitável;
  tradução/apelidos opcionais depois).
- Custo de API football-data: +1 chamada/dia (discovery) + poller nas janelas de jogo do
  BSA. Dentro do free tier (10 req/min).

## Consultas de validação usadas (read-only)

```sql
-- Divergência de pontos (bolão): 0 linhas divergentes
SELECT COUNT(*) FROM predictions p JOIN matches m ON m.id=p.match_id
WHERE m.status='FINISHED' AND p.points != (CASE
  WHEN p.pred_home_score=m.home_score AND p.pred_away_score=m.away_score THEN 3
  WHEN (p.pred_home_score-p.pred_away_score)=0 AND (m.home_score-m.away_score)=0 THEN 1
  WHEN (p.pred_home_score-p.pred_away_score)>0 AND (m.home_score-m.away_score)>0 THEN 1
  WHEN (p.pred_home_score-p.pred_away_score)<0 AND (m.home_score-m.away_score)<0 THEN 1
  ELSE 0 END);

-- Consistência scores vs predictions: 0 mismatches
SELECT COUNT(*) FROM scores s WHERE s.points_total !=
  (SELECT COALESCE(SUM(p.points),0) FROM predictions p
   WHERE p.round_id=s.round_id AND p.participant_name=s.participant_name);

-- Sobreposição entre as duas grafias do Jogador E: 0
SELECT COUNT(*) FROM predictions a JOIN predictions b ON a.match_id=b.match_id
 AND a.participant_name='<GRAFIA_1>' AND b.participant_name='<GRAFIA_2>';
```
