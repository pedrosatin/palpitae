/**
 * Fases que decidem o título de uma copa. `FINAL` vale para as copas da
 * football-data e da ESPN, para o Paulista e para o Gaúcho. O Mineiro decide o
 * título em `PLAYOFFS_FINAL`. O Carioca 2026 decide na final da Taça Guanabara.
 * As finais paralelas da Taça Rio, do Troféu Inconfidência e do Farroupilha
 * ficam de fora. Os formatos estão nos spikes em `docs/architecture/spike-espn-*.md`.
 */
export const TITLE_FINAL_PHASES = ['FINAL', 'PLAYOFFS_FINAL', 'TACA_GUANABARA_FINAL'] as const

/**
 * Status da competição do grupo, como a lista e o detalhe devolvem em
 * `competition_status`.
 *
 * `competitions.status` nasce 'upcoming' e o sync não atualiza a coluna. Por
 * isso o fim vem dos jogos gravados. Quando a coluna diz 'finished', ela vale.
 *
 * Liga acaba quando tem jogos e nenhum está pendente.
 *
 * Copa acaba quando tem jogos, nenhum está pendente e um deles é de
 * `TITLE_FINAL_PHASES`. Os providers só gravam jogo com os dois times
 * definidos. Entre uma fase e outra, todos os jogos gravados estão encerrados e
 * a copa continua viva. Isso acontece antes do sorteio da Copa do Brasil e
 * depois da fase de liga da Liga dos Campeões, que é tipada como copa. Sem jogo
 * pendente, a final gravada já terminou, então a busca dela não confere o
 * status. Tipo nulo conta como copa, o mesmo default da coluna.
 *
 * Nos outros casos vale a coluna.
 *
 * O fragmento usa os aliases do grupo e da competição, `g` e `c` por padrão,
 * com a competição vinda de `LEFT JOIN competitions c`. Sem grupo na consulta
 * (lista de competições), `competitionIdExpr` aponta o id, como `c.id`. Não usa binds. Cada
 * subquery busca os jogos pelo prefixo `competition_id` de
 * `idx_matches_comp_round_start`. A busca da final roda por último e só para
 * copa sem jogo pendente.
 */
export function competitionStatusSql(
  groupAlias = 'g',
  competitionAlias = 'c',
  competitionIdExpr = `${groupAlias}.competition_id`,
): string {
  const finalPhases = TITLE_FINAL_PHASES.map((phase) => `'${phase}'`).join(', ')
  return `CASE
            WHEN ${competitionAlias}.status = 'finished' THEN 'finished'
            WHEN EXISTS (
              SELECT 1 FROM matches m WHERE m.competition_id = ${competitionIdExpr}
            )
            AND NOT EXISTS (
              SELECT 1 FROM matches m
              WHERE m.competition_id = ${competitionIdExpr} AND m.status != 'finished'
            )
            AND (
              ${competitionAlias}.type = 'league'
              OR EXISTS (
                SELECT 1 FROM matches m
                WHERE m.competition_id = ${competitionIdExpr}
                  AND m.phase IN (${finalPhases})
              )
            )
            THEN 'finished'
            ELSE ${competitionAlias}.status
          END`
}
