/**
 * Pure helpers for turning a round's local score/penalty drafts into the
 * payload sent to `PUT /predictions/bulk`. Extracted from
 * `usePredictionsTab` so the "which drafts are worth saving" rule lives in one
 * testable place instead of a single 40-line closure.
 */
import { needsPenaltyPick } from './predictedTie'
import type { Match, Prediction } from '../components/MatchCard'

export type ScoreDraft = { home: string; away: string }
export type PenaltyWinner = 'home' | 'away' | null

export type RoundDraftPayload = {
  match_id: string
  predicted_home_score: number
  predicted_away_score: number
  predicted_penalty_winner?: PenaltyWinner
}

export type CollectRoundDraftsInput = {
  roundMatches: Match[]
  drafts: Map<string, ScoreDraft>
  penaltyDrafts: Map<string, PenaltyWinner>
  predictions: Map<string, Prediction>
}

/**
 * Travamento do front, o mesmo no card, nos rascunhos e no "Salvar todos". Espelha
 * api/src/matches/locking.ts (ADR-004): locked_at, status live/finished ou
 * prediction.locked fecham; postponed com horário passado e sem lock explícito
 * permanece aberto (start_time original).
 */
export function isMatchLocked(
  match: Match,
  prediction: Prediction | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (match.locked_at) return true
  if (match.status === 'live' || match.status === 'finished') return true
  if (prediction?.locked) return true
  if (match.postponed) return false
  return nowMs >= Date.parse(match.start_time)
}

/**
 * Resolve os dois campos do placar. Sem rascunho, vale o palpite salvo. Devolve
 * `null` quando um campo fica vazio, seja edição pela metade ou jogo sem palpite
 * e sem rascunho. O card começa vazio, e um 0×0 só existe quando o usuário escolhe.
 */
function resolveDraftScores(
  draft: ScoreDraft | undefined,
  prediction: Prediction | undefined,
): { home: number; away: number } | null {
  const homeStr = draft?.home ?? (prediction ? String(prediction.predicted_home_score) : '')
  const awayStr = draft?.away ?? (prediction ? String(prediction.predicted_away_score) : '')
  if (homeStr === '' || awayStr === '') return null
  return { home: Number(homeStr), away: Number(awayStr) }
}

/**
 * Works out the penalty winner for a drawn knockout score. `eligibleDraw` is
 * false unless the score is level and the match is decided on penalties; when
 * it is, the draft wins, else the saved prediction, else `null`.
 */
function resolvePenaltyWinner(
  match: Match,
  home: number,
  away: number,
  penaltyDraft: PenaltyWinner | undefined,
  hasPenaltyDraft: boolean,
  prediction: Prediction | undefined,
  leg1Prediction: Prediction | undefined,
): { eligibleDraw: boolean; winner: PenaltyWinner } {
  const eligibleDraw = needsPenaltyPick(match, home, away, leg1Prediction)
  if (!eligibleDraw) return { eligibleDraw, winner: null }
  const winner = hasPenaltyDraft
    ? (penaltyDraft ?? null)
    : (prediction?.predicted_penalty_winner ?? null)
  return { eligibleDraw, winner }
}

/** True when the resolved score or penalty winner differs from the saved prediction. */
function hasPredictionChange(
  home: number,
  away: number,
  penaltyWinner: PenaltyWinner,
  prediction: Prediction | undefined,
): boolean {
  const scoreChanged =
    !prediction ||
    home !== prediction.predicted_home_score ||
    away !== prediction.predicted_away_score
  const penaltyChanged = penaltyWinner !== (prediction?.predicted_penalty_winner ?? null)
  return scoreChanged || penaltyChanged
}

/** Palpite salvo com o placar trocado pelo rascunho, para o agregado da volta. */
function withDraftScore(
  matchId: string,
  draft: ScoreDraft,
  saved: Prediction | undefined,
): Prediction {
  return {
    ...saved,
    id: '',
    match_id: matchId,
    predicted_home_score: Number(draft.home),
    predicted_away_score: Number(draft.away),
    points_awarded: 0,
    locked: 0,
    updated_at: '',
  }
}

/**
 * Collects the drafts in `roundMatches` that are unlocked, complete and
 * actually different from what is already saved.
 */
export function collectRoundDrafts({
  roundMatches,
  drafts,
  penaltyDrafts,
  predictions,
}: CollectRoundDraftsInput): RoundDraftPayload[] {
  const out: RoundDraftPayload[] = []
  const effectivePredictions = new Map(predictions)
  for (const match of roundMatches) {
    if (isMatchLocked(match, predictions.get(match.id))) continue
    const draft = drafts.get(match.id)
    if (!draft || draft.home === '' || draft.away === '') continue
    effectivePredictions.set(match.id, withDraftScore(match.id, draft, predictions.get(match.id)))
  }

  for (const match of roundMatches) {
    const prediction = predictions.get(match.id)
    if (isMatchLocked(match, prediction)) continue

    const draft = drafts.get(match.id)
    const hasPenaltyDraft = penaltyDrafts.has(match.id)
    if (!draft && !hasPenaltyDraft) continue

    const scores = resolveDraftScores(draft, prediction)
    if (!scores) continue

    const { eligibleDraw, winner } = resolvePenaltyWinner(
      match,
      scores.home,
      scores.away,
      penaltyDrafts.get(match.id),
      hasPenaltyDraft,
      prediction,
      match.leg1_match_id ? effectivePredictions.get(match.leg1_match_id) : undefined,
    )
    if (eligibleDraw && winner === null) continue

    if (hasPredictionChange(scores.home, scores.away, winner, prediction)) {
      out.push({
        match_id: match.id,
        predicted_home_score: scores.home,
        predicted_away_score: scores.away,
        predicted_penalty_winner: winner,
      })
    }
  }

  return out
}

/**
 * Rascunho de um campo do card. `base` é o palpite salvo no momento da
 * digitação, no formato de `savedBase`. `at` é a hora da edição, em ms.
 */
export type DraftEntry<T> = { value: T; base: string; at: number }

/** Rascunhos com base e hora, como ficam no estado da aba e no storage. */
export type DraftEntries = {
  drafts: Map<string, DraftEntry<ScoreDraft>>
  penaltyDrafts: Map<string, DraftEntry<PenaltyWinner>>
}

/** Só os valores dos rascunhos, como os cards e o "Salvar todos" leem. */
export type UnsavedDrafts = {
  drafts: Map<string, ScoreDraft>
  penaltyDrafts: Map<string, PenaltyWinner>
}

export type PruneUnsavedDraftsInput = DraftEntries & {
  matches: Match[]
  predictions: Map<string, Prediction>
  /** Hora que decide quais jogos já fecharam. Padrão: agora. */
  nowMs?: number
}

/** Placar e pênalti salvos, como `1:0:null`. Jogo sem palpite vira `sem palpite`. */
export function savedBase(prediction: Prediction | undefined): string {
  if (!prediction) return 'sem palpite'
  const penalty = prediction.predicted_penalty_winner ?? 'null'
  return `${prediction.predicted_home_score}:${prediction.predicted_away_score}:${penalty}`
}

/**
 * Tira os rascunhos digitados sobre um palpite salvo que depois mudou. Sem
 * nada a tirar, devolve o mesmo objeto e o estado não muda.
 */
export function dropStaleDrafts(
  entries: DraftEntries,
  predictions: Map<string, Prediction>,
): DraftEntries {
  function fresh<T>(map: Map<string, DraftEntry<T>>) {
    let next: Map<string, DraftEntry<T>> | null = null
    for (const [matchId, entry] of map) {
      if (entry.base === savedBase(predictions.get(matchId))) continue
      next ??= new Map(map)
      next.delete(matchId)
    }
    return next ?? map
  }
  const drafts = fresh(entries.drafts)
  const penaltyDrafts = fresh(entries.penaltyDrafts)
  if (drafts === entries.drafts && penaltyDrafts === entries.penaltyDrafts) return entries
  return { drafts, penaltyDrafts }
}

/**
 * Rascunhos que ainda valem guardar. O jogo precisa estar na lista e aberto, e
 * o palpite salvo dele não pode ter mudado desde a digitação.
 *
 * Placar e pênalti são julgados em separado. O placar fica quando está completo
 * e difere do salvo. O pênalti fica quando difere do salvo e o placar resolvido
 * ainda pede a escolha, com a regra de `collectRoundDrafts`. Na volta, o
 * rascunho da ida só conta se ela estiver na mesma rodada.
 */
export function pruneUnsavedDrafts({
  matches,
  predictions,
  drafts,
  penaltyDrafts,
  nowMs = Date.now(),
}: PruneUnsavedDraftsInput): DraftEntries {
  const byId = new Map(matches.map((m) => [m.id, m]))
  function isCurrent(matchId: string, entry: DraftEntry<unknown>) {
    const match = byId.get(matchId)
    const saved = predictions.get(matchId)
    return (
      match !== undefined && !isMatchLocked(match, saved, nowMs) && entry.base === savedBase(saved)
    )
  }
  function currentScore(matchId: string) {
    const entry = drafts.get(matchId)
    return entry && isCurrent(matchId, entry) ? entry.value : undefined
  }
  function leg1Prediction(match: Match) {
    if (!match.leg1_match_id) return undefined
    const saved = predictions.get(match.leg1_match_id)
    const leg1 = byId.get(match.leg1_match_id)
    const draft = currentScore(match.leg1_match_id)
    if (!leg1 || leg1.round !== match.round || !draft || draft.home === '' || draft.away === '') {
      return saved
    }
    return withDraftScore(leg1.id, draft, saved)
  }

  const keptDrafts = new Map<string, DraftEntry<ScoreDraft>>()
  for (const [matchId, entry] of drafts) {
    const { home, away } = entry.value
    if (!isCurrent(matchId, entry) || home === '' || away === '') continue
    const saved = predictions.get(matchId)
    const sameAsSaved =
      saved !== undefined &&
      Number(home) === saved.predicted_home_score &&
      Number(away) === saved.predicted_away_score
    if (!sameAsSaved) keptDrafts.set(matchId, entry)
  }

  const keptPenalties = new Map<string, DraftEntry<PenaltyWinner>>()
  for (const [matchId, entry] of penaltyDrafts) {
    if (!isCurrent(matchId, entry)) continue
    const match = byId.get(matchId)!
    const saved = predictions.get(matchId)
    if (entry.value === (saved?.predicted_penalty_winner ?? null)) continue
    const scores = resolveDraftScores(currentScore(matchId), saved)
    if (scores && needsPenaltyPick(match, scores.home, scores.away, leg1Prediction(match))) {
      keptPenalties.set(matchId, entry)
    }
  }
  return { drafts: keptDrafts, penaltyDrafts: keptPenalties }
}

export function draftValues({ drafts, penaltyDrafts }: DraftEntries): UnsavedDrafts {
  const values = <T>(map: Map<string, DraftEntry<T>>) =>
    new Map([...map].map(([matchId, entry]) => [matchId, entry.value]))
  return { drafts: values(drafts), penaltyDrafts: values(penaltyDrafts) }
}

/** Rodadas com algum rascunho, para o seletor mostrar onde eles estão. */
export function roundsWithDrafts(matches: Match[], { drafts, penaltyDrafts }: DraftEntries) {
  const rounds = new Set<string>()
  for (const match of matches) {
    if (drafts.has(match.id) || penaltyDrafts.has(match.id)) rounds.add(match.round)
  }
  return rounds
}
