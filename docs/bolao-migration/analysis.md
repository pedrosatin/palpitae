# Migração bolao-brasileirao → Palpitae — Análise de Viabilidade

> Data: 2026-07-12 · Status: **análise aprovada, execução pendente**
> Fontes: código dos dois repositórios + consultas read-only aos D1 de produção
> (`bolao-brasileirao` `28b1c613…`, `palpitae` `ffd7a7ed…`). Nada foi escrito em produção.

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

| Bolão (`participant_name`) | Palpitae `users.email` | `users.id` |
|---|---|---|
| satin | pedro5satin@gmail.com | `7c13016e-5ae7-4e35-acc2-f6115dc94c1c` |
| Chu | caaio.sperez@gmail.com | `69478023-3b14-480f-b999-adc02c99816a` |
| FABRE | fabreduarte@gmail.com | `e1072bec-d62d-439f-9e49-31ea92c02ce4` |
| PDR | pedrolucas.ac10@gmail.com | `d34b5d2e-00ee-4802-bff4-2272b03380e9` |
| WEEGEE **e** WEEGGE | gustavokl1996@gmail.com | `482b2145-dc50-4a8e-8e15-293ea6af4e60` |
| Isa | itngodoy@gmail.com | `15473f3c-bb85-4315-9c13-4e716746a47d` |

WEEGEE/WEEGGE são grafias do mesmo jogador: **0 partidas em comum** entre as duas →
fusão segura (145+10 = 155 palpites, 103+3 = 106 pts).

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
   `points_winner=1`, `points_penalty=0`, owner satin; inserir os 6 `group_members`.
   Decidir `predictions_visibility` (`public` replica o comportamento do bolão antigo).
3. **Importar palpites** — script gera SQL com as 773 predictions (mapeamento acima),
   aplicado via `wrangler d1 execute --remote --file`. Palpites de jogos futuros entram
   com `points_awarded=0` e serão pontuados pelo poller normalmente.
4. **Leaderboard + validação** — rodar recálculo do grupo (mesma query de
   `recalculateLeaderboard`) e conferir totais esperados:
   Chu 98 · satin 88 (WEEGEE 106 fundido) · Isa 61 · PDR 54 · FABRE 42
   (ordem final: WEEGEE 106, Chu 98, satin 88, Isa 61, PDR 54, FABRE 42).
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
- 3 jogos POSTPONED viram `scheduled` no Palpitae (mapStatus) — ok, poller resolve.
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

-- Sobreposição WEEGEE/WEEGGE: 0
SELECT COUNT(*) FROM predictions a JOIN predictions b ON a.match_id=b.match_id
 AND a.participant_name='WEEGEE' AND b.participant_name='WEEGGE';
```
