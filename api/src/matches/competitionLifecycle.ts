import type { D1Database } from '@cloudflare/workers-types'
import { daysBeforeSql, finishedByMatchesSql } from '../groups/competitionStatus'

/**
 * Dias entre o último jogo gravado e a gravação de 'finished' na coluna. Nesse
 * intervalo a tela já mostra a competição encerrada (`competitionStatusSql`),
 * mas a descoberta segue buscando o calendário. Assim entram as correções de
 * placar da football-data e a volta de uma final que a ESPN ainda não mostrava:
 * com até 14 dias entre ida e volta, a volta entra no horizonte de 7 dias da
 * descoberta antes do fim da confirmação.
 */
export const FINISH_CONFIRMATION_DAYS = 7

/** Instante da execução em `?1` e id da competição em `?2`. */
const RECONCILE_SQL = `UPDATE competitions
   SET status = CASE
     WHEN ${finishedByMatchesSql('competitions', 'competitions.id', '?1')}
      AND (
        SELECT MAX(m.start_time) FROM matches m
        WHERE m.competition_id = competitions.id
      ) <= ${daysBeforeSql('?1', FINISH_CONFIRMATION_DAYS)}
     THEN 'finished'
     WHEN EXISTS (
       SELECT 1 FROM matches m
       WHERE m.competition_id = competitions.id AND m.status IN ('live', 'finished')
     )
     THEN 'ongoing'
     ELSE status
   END
 WHERE id = ?2 AND status != 'finished'
 RETURNING status`

/**
 * Avança `competitions.status` pelos jogos gravados: 'upcoming' vira 'ongoing'
 * quando um jogo começa, e a competição vira 'finished' pela regra de
 * `finishedByMatchesSql`, depois de `FINISH_CONFIRMATION_DAYS` dias sem jogo
 * novo. Só avança: 'finished' não volta, e correção de placar depois disso não
 * reabre a competição. A visibilidade não muda.
 *
 * A descoberta chama depois de sincronizar a competição, com o calendário
 * atualizado. Devolve o status gravado, ou `null` se a competição já estava
 * encerrada ou não existe.
 */
export async function reconcileCompetitionStatus(
  db: D1Database,
  competitionId: string,
  now: number,
): Promise<string | null> {
  const row = await db
    .prepare(RECONCILE_SQL)
    .bind(new Date(now).toISOString(), competitionId)
    .first<{ status: string }>()
  return row?.status ?? null
}
