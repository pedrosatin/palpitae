/**
 * Regra única da rodada padrão (`default_round`), usada por `GET /matches`,
 * `GET /predictions/user` e pela contagem de palpites pendentes da home.
 *
 * Candidata = rodada com algum jogo no futuro (`MAX(start_time) > now`). Entre as
 * candidatas vence a de menor `MAX(start_time)`, exceto as rodadas que ficaram
 * para trás: aquelas em que a maioria dos jogos começou há mais de
 * `LEFTOVER_ROUND_AGE_DAYS` dias. Elas vão para o fim da fila. Se todas as
 * candidatas ficaram para trás (fim de temporada com um jogo remarcado), a
 * ordem volta a ser só o `MAX(start_time)`.
 *
 * Um jogo remarcado para semanas depois mantém a rodada antiga aberta.
 * No Brasileirão 2026 a rodada 21 tinha 9 jogos encerrados entre julho e outubro
 * e Chapecoense × Vasco remarcado para 14/11, antes do último jogo da rodada 35.
 * Pela regra antiga o grupo abria na 21. O jogo remarcado continua visível pela
 * dica da aba Palpitar e entra na contagem de pendentes.
 *
 * Rodada em andamento tem jogos recentes ou futuros, então não fica para trás.
 * Mata-mata de ida e volta numa mesma rodada tem metade dos jogos na ida.
 * Metade não é maioria, então a rodada segue padrão até a volta.
 *
 * O "começou" é só pelo horário (`start_time <= now - 7 dias`), sem olhar
 * `status` nem `postponed`. Adiado guarda o horário original (ADR-013), e esse
 * horário passado conta como jogo antigo da rodada.
 *
 * O front repete só o "ficou para trás" em `web/src/lib/rounds.ts`
 * (`rescheduledOpenByRound`) para a dica de jogo remarcado. A rodada padrão
 * chega pronta no `default_round`.
 */
export const LEFTOVER_ROUND_AGE_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/** Corte em ISO 8601: jogos com `start_time` até aqui contam como antigos. */
export function leftoverCutoff(nowIso: string): string {
  return new Date(Date.parse(nowIso) - LEFTOVER_ROUND_AGE_DAYS * DAY_MS).toISOString()
}

/**
 * Ordem das candidatas. A primeira é a rodada padrão.
 *
 * Empate no último jogo aparece no fim de temporada, quando duas rodadas antigas
 * têm um remarcado no mesmo horário. Vence a que começou depois. A dica da aba
 * Palpitar procura rodadas antes da aberta, então aponta a outra. `round` fecha o
 * desempate, porque é a chave do `GROUP BY`.
 */
const ROUND_ORDER = 'leftover ASC, last_start ASC, first_start DESC, round ASC'

/**
 * Rodadas candidatas, com `round`, `leftover` (0/1), `first_start` e `last_start`.
 *
 * `competitionSql` é a expressão da competição: `?` (bind do chamador), uma
 * subconsulta ou uma coluna correlacionada. Os binds da regra vêm antes, na
 * subconsulta `rule`, para que a ordem não dependa de onde o `?` cai no texto:
 * `...roundRuleBinds(now)` e depois os binds de `competitionSql`.
 */
function candidateRoundsSql(competitionSql: string, alias: string): string {
  const c = alias ? `${alias}.` : ''
  const from = alias ? `matches ${alias}` : 'matches'
  return `SELECT ${c}round AS round,
                 (2 * SUM(${c}start_time <= rule.cutoff) > COUNT(*)) AS leftover,
                 MIN(${c}start_time) AS first_start,
                 MAX(${c}start_time) AS last_start
          FROM (SELECT ? AS cutoff, ? AS now) rule
          JOIN ${from} ON ${c}competition_id = ${competitionSql}
          GROUP BY ${c}round
          HAVING MAX(${c}start_time) > rule.now`
}

/** Binds da regra, antes dos binds de `competitionSql`. */
export function roundRuleBinds(nowIso: string): [string, string] {
  return [leftoverCutoff(nowIso), nowIso]
}

/**
 * Consulta da rodada padrão: zero ou uma linha com `round`. Sem linha, o
 * chamador cai no último jogo da competição (fim de temporada).
 */
export function defaultRoundSql(competitionSql: string, alias = ''): string {
  return `SELECT round FROM (${candidateRoundsSql(competitionSql, alias)})
          ORDER BY ${ROUND_ORDER}
          LIMIT 1`
}

/**
 * Rodada padrão e rodadas que ficaram para trás com jogo futuro, numa varredura
 * só do índice da competição. Devolve `round` e `position`. A padrão tem
 * `position = 1`. As demais são as que ficaram para trás, menos a rodada padrão.
 * A padrão só fica para trás quando todas as candidatas ficaram.
 */
export function openRoundsSql(competitionSql: string, alias = ''): string {
  return `SELECT round, position FROM (
            SELECT round, leftover, ROW_NUMBER() OVER (ORDER BY ${ROUND_ORDER}) AS position
            FROM (${candidateRoundsSql(competitionSql, alias)})
          )
          WHERE position = 1 OR leftover = 1`
}
