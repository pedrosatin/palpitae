# Reparo do adiado encerrado pela ESPN (Estoril × Marítimo, 08/11/2026)

O fallback de resultados da ESPN gravou Estoril × Marítimo (Primeira Liga, rodada 11) como `finished` 0-0 e a pontuação rodou. A ESPN mandou `STATUS_POSTPONED` com `state = 'post'`, `completed = false` e placar 0-0. A correção de código impede novos casos; este roteiro devolve o jogo ao estado de adiado: `scheduled`, sem placar e sem `scored_at`. A flag `postponed = 1` e o horário original ficam como estão, e o sync da football-data grava a data nova quando o jogo for remarcado.

Em 10/11/2026 a consulta de leitura em produção achou só esta linha com a assinatura do erro. É o único jogo encerrado sem `locked_at`, ou seja, que nenhum sync do provedor viu começar. O jogo tem 0 palpites e a Primeira Liga não tem grupo, então nenhum ponto nem ranking muda.

| Campo | Valor em produção |
|---|---|
| `id` | `8361f3a5-263b-489f-92f2-b597bb7a2775` |
| `external_id` | `567348` (football-data) |
| `start_time` | `2026-11-08T15:30:00Z` |
| `status`, placar | `finished`, 0-0 |
| `postponed`, `locked_at` | `1`, `NULL` |
| `scored_at` | `2026-11-08T17:30:35.950Z` |

## Pré-condições

1. A correção do fallback e do sync ESPN já está em produção. Sem ela, um novo adiado pode voltar a ser encerrado.
2. A aplicação no D1 remoto tem autorização específica do operador.
3. Os comandos rodam de `api/`, sempre com `--config ./wrangler.toml`. Sem essa opção, o `wrangler.jsonc` da raiz vence.

```bash
cd api
export D1="npx wrangler d1 execute palpitae --remote --config ./wrangler.toml"
mkdir -p ~/.cache/scratch/reparo-adiado-espn
```

## 1. Conferência prévia

Varredura de jogos encerrados que nenhum sync viu começar, com a contagem de palpites. O resultado esperado é uma linha, a de Estoril × Marítimo, com `palpites = 0`. Se aparecer outra linha ou palpite, pare e reavalie.

```sql
SELECT m.id, m.external_id, m.start_time, m.status, m.postponed, m.home_score, m.away_score, m.scored_at, (SELECT COUNT(*) FROM predictions p WHERE p.match_id = m.id) AS palpites FROM matches m WHERE m.status = 'finished' AND m.locked_at IS NULL;
```

Totais de pontos, para comparar no fim. Rode logo antes do passo 3, porque a pontuação de outros jogos pode mudar os totais entre uma consulta e outra.

```sql
SELECT (SELECT COUNT(*) FROM leaderboard) AS ranking_linhas, (SELECT SUM(total_points) FROM leaderboard) AS ranking_pontos, (SELECT COUNT(*) FROM predictions) AS palpites, (SELECT SUM(points_awarded + penalty_points + classified_points) FROM predictions) AS palpites_pontos;
```

## 2. Backup dos campos

```sql
SELECT id, start_time, status, postponed, home_score, away_score, scored_at, locked_at FROM matches WHERE id = '8361f3a5-263b-489f-92f2-b597bb7a2775';
```

```bash
$D1 --json --command "<SQL acima>" > ~/.cache/scratch/reparo-adiado-espn/backup-$(date +%Y%m%dT%H%M%S).json
```

## 3. Reparo

O `UPDATE` só vale para o estado errado: mesmo `id` e `external_id`, encerrado, adiado, sem `locked_at`, 0-0 e sem palpite. Uma segunda execução devolve `changes = 0`.

```sql
UPDATE matches SET status = 'scheduled', home_score = NULL, away_score = NULL, scored_at = NULL WHERE id = '8361f3a5-263b-489f-92f2-b597bb7a2775' AND external_id = '567348' AND provider = 'football-data' AND status = 'finished' AND postponed = 1 AND locked_at IS NULL AND home_score = 0 AND away_score = 0 AND NOT EXISTS (SELECT 1 FROM predictions WHERE match_id = matches.id);
```

Resultado esperado: `changes = 1` na primeira execução e `0` depois.

## 4. Conferência posterior

1. A consulta do passo 2 devolve `status = 'scheduled'`, placar e `scored_at` nulos, `postponed = 1` e o mesmo `start_time`.
2. A varredura do passo 1 não devolve linhas.
3. Os totais do passo 1 são iguais aos de antes.

Depois do reparo o poller não consulta o jogo, porque ele está adiado e o horário original saiu da janela ativa. Quando a football-data remarcar a partida, o sync troca a data e zera `postponed`. Antes do reparo isso não acontecia, porque o upsert não regride um jogo `finished`.

## Reversão

Devolve o estado anterior, que é o errado. Só faz sentido se o reparo causar um problema inesperado e o jogo ainda não tiver sido remarcado.

```sql
UPDATE matches SET status = 'finished', home_score = 0, away_score = 0, scored_at = '2026-11-08T17:30:35.950Z' WHERE id = '8361f3a5-263b-489f-92f2-b597bb7a2775' AND status = 'scheduled' AND postponed = 1 AND home_score IS NULL AND away_score IS NULL AND start_time = '2026-11-08T15:30:00Z';
```
