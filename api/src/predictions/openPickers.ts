import { lockedSql } from '../matches/locking'

/** Id do jogo aberto para os ids dos membros que já palpitaram nele. */
export type OpenPickers = Record<string, string[]>

type PickerRow = { match_id: string; user_id: string }

/**
 * Quem já palpitou cada jogo ainda aberto do grupo. Alimenta o "4 de 6 palpitaram"
 * da aba Grupo.
 *
 * O SELECT traz `match_id` e `user_id`, sem placar, vencedor dos pênaltis ou pontos.
 * Com isso o grupo oculto recebe a lista antes do início e o filtro anti-cópia de
 * `predictions` continua igual. `NOT lockedSql` é a regra de escrita, então jogo
 * adiado que não começou segue na lista (ver locking.ts).
 *
 * Roda a cada abertura da aba Grupo. Os `CROSS JOIN` fixam a ordem. Os jogos vêm do
 * índice por competição, e cada par de jogo aberto e membro vem do índice único de
 * `predictions`, sem ler a linha. O custo acompanha jogos abertos vezes membros e não
 * cresce com os palpites antigos do grupo. O `group_members` deixa de fora quem saiu.
 *
 * Binds: group_id, competition_id, now.
 */
export const OPEN_PICKERS_SQL = `SELECT pr.match_id, pr.user_id
  FROM matches m
  CROSS JOIN group_members gm ON gm.group_id = ?
  CROSS JOIN predictions pr
    ON pr.user_id = gm.user_id AND pr.group_id = gm.group_id AND pr.match_id = m.id
  WHERE m.competition_id = ? AND NOT ${lockedSql()}
    AND NOT EXISTS (SELECT 1 FROM group_bans b WHERE b.group_id = gm.group_id AND b.user_id = gm.user_id)`

/** Agrupa as linhas por jogo, no formato do campo `open_pickers` da resposta. */
export function indexOpenPickers(rows: PickerRow[]): OpenPickers {
  const byMatch: OpenPickers = {}
  for (const row of rows) (byMatch[row.match_id] ??= []).push(row.user_id)
  return byMatch
}

export async function fetchOpenPickers(
  db: D1Database,
  groupId: string,
  competitionId: string,
  now: string,
): Promise<OpenPickers> {
  const { results } = await db
    .prepare(OPEN_PICKERS_SQL)
    .bind(groupId, competitionId, now)
    .all<PickerRow>()
  return indexOpenPickers(results)
}
