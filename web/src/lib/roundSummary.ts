import type { Match } from '../components/MatchCard'
import { joinNames, type GroupMember } from './groupReminder'
import { isGroupStageRound } from './rounds'

/** Campos de um palpite que o resumo lê. Servem ao palpite próprio e ao do grupo. */
export interface RoundPick {
  match_id: string
  predicted_home_score: number
  predicted_away_score: number
  points_awarded: number
  penalty_points?: number | null
  classified_points?: number | null
}

export interface GroupRoundPick extends RoundPick {
  user_id: string
}

export interface RoundScope {
  /** Jogos encerrados da rodada. Só eles entram em qualquer conta do resumo. */
  finished: Match[]
  /** Jogos adiados que ainda valem pontos. */
  postponed: number
}

/**
 * Jogos que o resumo da rodada considera. Devolve `null` quando a rodada não tem
 * resumo.
 *
 * A rodada tem resumo quando ao menos um jogo acabou e todos os outros estão
 * adiados. Jogo aberto, ao vivo ou remarcado para o futuro mantém a rodada em
 * andamento. Mata-mata fica de fora (ida e volta, pênaltis e fases sem número),
 * até a auditoria 10 decidir como somar pontos nele.
 */
export function roundScope(roundMatches: Match[]): RoundScope | null {
  if (roundMatches.length === 0) return null
  if (!isGroupStageRound(roundMatches[0].round)) return null
  if (
    roundMatches.some(
      (m) => (m.tie_role && m.tie_role !== 'single') || Boolean(m.decides_on_penalties),
    )
  ) {
    return null
  }
  const finished = roundMatches.filter((m) => m.status === 'finished')
  const postponed = roundMatches.filter((m) => m.status !== 'finished' && Boolean(m.postponed))
  if (finished.length === 0 || finished.length + postponed.length !== roundMatches.length) {
    return null
  }
  return { finished, postponed: postponed.length }
}

/** Pontos do palpite no jogo, a mesma soma que o chip do card mostra. */
export function pickPoints(p: RoundPick): number {
  return p.points_awarded + (p.penalty_points ?? 0) + (p.classified_points ?? 0)
}

export interface RoundTally {
  points: number
  /** Placares cravados. Sempre 0 num grupo que só pontua o resultado. */
  exact: number
  /** Resultado certo sem cravar o placar. Num grupo só de resultado, todos os acertos. */
  correct: number
  /** Jogos encerrados sem palpite. */
  missed: number
}

/** Totais de um jogador nos jogos encerrados. `picks` pode trazer jogos de outras rodadas. */
export function tallyRound(finished: Match[], picks: RoundPick[], pointsExact: number): RoundTally {
  const byMatch = new Map(picks.map((p) => [p.match_id, p]))
  const tally: RoundTally = { points: 0, exact: 0, correct: 0, missed: 0 }
  for (const match of finished) {
    const pick = byMatch.get(match.id)
    if (!pick) {
      tally.missed += 1
      continue
    }
    tally.points += pickPoints(pick)
    if (match.home_score === null || match.away_score === null) continue
    const exact =
      pick.predicted_home_score === match.home_score &&
      pick.predicted_away_score === match.away_score
    if (exact && pointsExact > 0) {
      tally.exact += 1
    } else if (
      Math.sign(pick.predicted_home_score - pick.predicted_away_score) ===
      Math.sign(match.home_score - match.away_score)
    ) {
      tally.correct += 1
    }
  }
  return tally
}

export interface RoundStanding extends RoundTally {
  user_id: string
  display: string
  /** Colocação na rodada. Pontos iguais dividem a mesma colocação. */
  position: number
  isYou: boolean
}

/**
 * Classificação da rodada entre os membros. Só os jogos encerrados contam, então um
 * palpite de jogo ainda aberto nunca entra, mesmo que a resposta o traga. Quem não
 * palpitou fica com 0. Empata em pontos, desempata por placares exatos e depois pelo
 * nome, só para fixar a ordem. A colocação ignora esse desempate.
 */
export function rankRound(
  finished: Match[],
  picks: GroupRoundPick[],
  members: GroupMember[],
  selfUserId: string,
  pointsExact: number,
): RoundStanding[] {
  const finishedIds = new Set(finished.map((m) => m.id))
  const byUser = new Map<string, GroupRoundPick[]>()
  for (const p of picks) {
    if (!finishedIds.has(p.match_id)) continue
    byUser.set(p.user_id, [...(byUser.get(p.user_id) ?? []), p])
  }

  const rows = members.map((m) => ({
    user_id: m.user_id,
    display: m.display,
    isYou: m.user_id === selfUserId,
    ...tallyRound(finished, byUser.get(m.user_id) ?? [], pointsExact),
  }))
  rows.sort(
    (a, b) =>
      b.points - a.points || b.exact - a.exact || a.display.localeCompare(b.display, 'pt-BR'),
  )

  return rows.map((row) => ({
    ...row,
    position: rows.findIndex((r) => r.points === row.points) + 1,
  }))
}

/** Quem fez a maior pontuação da rodada. Vazio quando ninguém pontuou. */
export function roundLeaders(standings: RoundStanding[]): RoundStanding[] {
  const top = standings[0]
  if (!top || top.points <= 0) return []
  return standings.filter((s) => s.points === top.points)
}

const LEADER_NAMES = 3

export function pointsLabel(n: number): string {
  return `${n} ${n === 1 ? 'ponto' : 'pontos'}`
}

/**
 * Frase do destaque da rodada. Empate lista até 3 nomes e some o resto em "e mais N".
 * Quem vê a tela aparece primeiro, como "você".
 */
export function highlightText(leaders: RoundStanding[]): string | null {
  if (leaders.length === 0) return null
  // Quem vê a tela vem primeiro, para nunca cair no "e mais N".
  const ordered = [...leaders.filter((l) => l.isYou), ...leaders.filter((l) => !l.isYou)]
  const names = ordered.map((l) => (l.isYou ? 'você' : l.display))
  const subject = joinNames(names, LEADER_NAMES)
  const verb = leaders.length === 1 ? 'fez' : 'fizeram'
  const text = `${subject} ${verb} ${pointsLabel(leaders[0].points)}, a maior da rodada`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Aviso do jogo adiado, como `1 jogo adiado ainda vale pontos`. */
export function postponedNotice(postponed: number): string | null {
  if (postponed <= 0) return null
  return postponed === 1
    ? '1 jogo adiado ainda vale pontos'
    : `${postponed} jogos adiados ainda valem pontos`
}
