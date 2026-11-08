import { ACTIVE_RESULT_WINDOW_MS } from '../matches/matchPollingWindow'

/**
 * Jogos em andamento por competição, para o status dos cards do painel.
 *
 * O sync grava só `scheduled` ou `finished`, pelo `mapStatus` de `sync.ts`, e
 * o início do jogo vira `locked_at`. Em andamento é o jogo que já começou pelo
 * horário, não está adiado e ainda não tem resultado, dentro de
 * `ACTIVE_RESULT_WINDOW_MS`, a janela em que o poller ainda busca o resultado.
 * Fora dela, um jogo sem resultado deixa de aparecer como ao vivo. O poller
 * roda a cada 30 minutos e só pede o resultado depois de 115 minutos do
 * início. Um jogo encerrado segue ao vivo até essa busca e, com o provider
 * atrasado, até o fim da janela.
 *
 * A consulta não depende dos grupos do usuário e roda junto com a lista. Busca
 * só os jogos da janela pelo `idx_matches_start_time`, de todas as competições.
 * O `+` em `competition_id` tira `idx_matches_comp_round_start` das opções do
 * planejador. Ler esse índice em ordem evitaria a ordenação do `GROUP BY` ao
 * custo de ler todos os jogos do banco.
 */
export const LIVE_MATCHES_SQL = `
  SELECT +competition_id AS competition_id, COUNT(*) AS live_matches
  FROM matches
  WHERE start_time > ?
    AND start_time <= ?
    AND postponed = 0
    AND status != 'finished'
  GROUP BY +competition_id`

/** Binds na ordem exigida por `LIVE_MATCHES_SQL`. */
export function liveMatchesBinds(nowIso: string): [string, string] {
  const windowStart = new Date(Date.parse(nowIso) - ACTIVE_RESULT_WINDOW_MS).toISOString()
  return [windowStart, nowIso]
}

/** Jogos em andamento por `competition_id`. Competição sem jogo fica fora do mapa. */
export async function fetchLiveMatchesByCompetition(
  db: D1Database,
  nowIso: string,
): Promise<Map<string, number>> {
  const rows = await db
    .prepare(LIVE_MATCHES_SQL)
    .bind(...liveMatchesBinds(nowIso))
    .all<{ competition_id: string; live_matches: number }>()
  return new Map(rows.results.map((row) => [row.competition_id, row.live_matches]))
}
