/**
 * Fases que decidem o título de uma copa. `FINAL` vale para as copas da
 * football-data e da ESPN, para o Paulista e para o Gaúcho. O Mineiro decide o
 * título em `PLAYOFFS_FINAL`. O Carioca 2026 decide na final da Taça Guanabara.
 * As finais paralelas da Taça Rio, do Troféu Inconfidência e do Farroupilha
 * ficam de fora. Os formatos estão nos spikes em `docs/architecture/spike-espn-*.md`.
 */
export const TITLE_FINAL_PHASES = ['FINAL', 'PLAYOFFS_FINAL', 'TACA_GUANABARA_FINAL'] as const

/**
 * Liga de provedor sem calendário completo (a descoberta da ESPN só enxerga de
 * ontem até hoje + 7 dias) só acaba depois deste tempo sem jogo novo. Data FIFA
 * ou pausa de Copa do Mundo deixam a liga dias sem jogo gravado pendente, e uma
 * pausa de Copa pode passar de 50 dias. 60 dias sem jogo, mais os 7 dias que a
 * descoberta enxerga adiante, ainda separam a pausa do fim da temporada.
 */
export const PARTIAL_CALENDAR_LEAGUE_IDLE_DAYS = 60

/** Expressão SQL do instante atual no formato de `matches.start_time`. */
export const SQL_NOW = `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`

/** Instante `days` dias antes de `nowExpr`, no formato de `matches.start_time`. */
export function daysBeforeSql(nowExpr: string, days: number): string {
  return `strftime('%Y-%m-%dT%H:%M:%SZ', ${nowExpr}, '-${days} days')`
}

/**
 * Condição SQL de competição encerrada pelos jogos gravados, sem olhar a coluna
 * `status`.
 *
 * Os providers só gravam jogo com os dois times definidos, então a lista de
 * jogos pode estar incompleta. A regra só encerra quando nenhum jogo gravado
 * está pendente e há sinal de fim:
 *
 * - Copa: um jogo de `TITLE_FINAL_PHASES` que não seja ida. Entre uma fase e
 *   outra, todos os jogos gravados estão encerrados e a copa continua viva.
 *   Isso acontece antes do sorteio da Copa do Brasil e depois da fase de liga
 *   da Liga dos Campeões, que é tipada como copa. Na final em ida e volta, a
 *   ESPN informa `leg`; com só a ida gravada, a volta ainda não entrou no
 *   horizonte da descoberta. Tipo nulo conta como copa, o mesmo default da
 *   coluna.
 * - Liga da football-data: a descoberta traz o calendário inteiro, então basta
 *   não ter jogo pendente.
 * - Liga de outro provedor: o último jogo gravado começou há mais de
 *   `PARTIAL_CALENDAR_LEAGUE_IDLE_DAYS` dias.
 *
 * `nowExpr` é a expressão SQL do instante atual. Cada subquery busca os jogos
 * pelo prefixo `competition_id` de `idx_matches_comp_round_start`.
 */
export function finishedByMatchesSql(
  competitionAlias: string,
  competitionIdExpr: string,
  nowExpr: string,
): string {
  const finalPhases = TITLE_FINAL_PHASES.map((phase) => `'${phase}'`).join(', ')
  return `EXISTS (
              SELECT 1 FROM matches m WHERE m.competition_id = ${competitionIdExpr}
            )
            AND NOT EXISTS (
              SELECT 1 FROM matches m
              WHERE m.competition_id = ${competitionIdExpr} AND m.status != 'finished'
            )
            AND (
              (${competitionAlias}.type = 'league'
                AND (
                  ${competitionAlias}.provider = 'football-data'
                  OR (
                    SELECT MAX(m.start_time) FROM matches m
                    WHERE m.competition_id = ${competitionIdExpr}
                  ) <= ${daysBeforeSql(nowExpr, PARTIAL_CALENDAR_LEAGUE_IDLE_DAYS)}
                ))
              OR (COALESCE(${competitionAlias}.type, 'cup') = 'cup' AND EXISTS (
                SELECT 1 FROM matches m
                WHERE m.competition_id = ${competitionIdExpr}
                  AND m.phase IN (${finalPhases})
                  AND COALESCE(m.leg, 0) != 1
              ))
            )`
}

/**
 * Status da competição do grupo, como a lista e o detalhe devolvem em
 * `competition_status`.
 *
 * `competitions.status` só avança na descoberta diária, depois de alguns dias
 * de confirmação (`reconcileCompetitionStatus`). Por isso o fim também vem dos
 * jogos gravados, pela regra de `finishedByMatchesSql`. Quando a coluna diz
 * 'finished', ela vale. Nos outros casos vale a coluna.
 *
 * O fragmento usa os aliases do grupo e da competição, `g` e `c` por padrão,
 * com a competição vinda de `LEFT JOIN competitions c`. Sem grupo na consulta
 * (lista de competições), `competitionIdExpr` aponta o id, como `c.id`. Não usa
 * binds. A busca da final roda por último e só para copa sem jogo pendente.
 */
export function competitionStatusSql(
  groupAlias = 'g',
  competitionAlias = 'c',
  competitionIdExpr = `${groupAlias}.competition_id`,
): string {
  return `CASE
            WHEN ${competitionAlias}.status = 'finished' THEN 'finished'
            WHEN ${finishedByMatchesSql(competitionAlias, competitionIdExpr, SQL_NOW)}
            THEN 'finished'
            ELSE ${competitionAlias}.status
          END`
}
