import { useEffect, useRef, useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import { useMatchRounds } from '../../hooks/useMatchRounds'
import { useNow } from '../../hooks/useNow'
import { invalidateApiCache } from '../../lib/api-cache'
import { fetchGroupPredictions } from '../../lib/groupPredictions'
import { roundReminder, type GroupMember, type OpenPickers } from '../../lib/groupReminder'
import { formatMatchDate } from '../../lib/matchTime'
import { isMatchLocked } from '../../lib/predictionDrafts'
import { applyDefaultRoundFromMatches, fetchCompetitionMatches } from '../../lib/competitionMatches'
import ErrorState from '../ErrorState'
import type { Match } from '../MatchCard'
import PenaltyBadge from '../PenaltyBadge'
import RoundHeader from '../RoundHeader/RoundHeader'
import { MatchPickers, RoundReminderSummary } from './GroupPicksPresence'
import styles from './GroupPicksTab.module.css'

const TICK_MS = 30_000

/** Por quanto tempo depois da primeira busca a aba busca de novo até a API revelar os palpites. */
const REVEAL_RETRY_MS = 5 * 60_000

interface GroupPicksTabProps {
  groupId: string
  competitionId: string
  groupName?: string
  predictionsVisibility?: string
}

interface MemberPrediction {
  match_id: string
  user_id: string
  user_display: string
  predicted_home_score: number
  predicted_away_score: number
  predicted_penalty_winner: 'home' | 'away' | null
  points_awarded: number
  classified_points?: number
  predicted_classified?: 'home' | 'away' | null
  penalty_points: number
  locked: 0 | 1
}

interface GroupPicksResponse {
  self_user_id: string
  members: GroupMember[]
  predictions: MemberPrediction[]
  /** Ausente na API antiga. Sem o campo, a aba não afirma quem palpitou. */
  open_pickers?: OpenPickers
}

interface PickRow {
  user_id: string
  user_display: string
  pick: MemberPrediction | null
}

/**
 * Diz se a resposta da API é de depois do travamento do jogo. A API calcula `locked`
 * com o relógio do servidor, e todos os palpites de um jogo vêm com o mesmo valor.
 * Um palpite com `locked` igual a 0 mostra que a resposta é de antes do travamento,
 * mesmo que o relógio local já tenha passado do horário de início. Sem palpite na
 * resposta, valem o status e o `locked_at` do jogo.
 */
function serverConfirmsLock(match: Match, memberPicks: MemberPrediction[]): boolean {
  if (memberPicks.some((p) => p.locked !== 1)) return false
  return (
    memberPicks.length > 0 ||
    match.status === 'live' ||
    match.status === 'finished' ||
    Boolean(match.locked_at)
  )
}

/**
 * Jogos da rodada que já começaram pelo relógio local e que a última resposta da API
 * ainda trata como abertos, com palpite de `locked` 0 ou com a lista de quem palpitou
 * neles. Os palpites dos outros membros só chegam numa nova busca. Cada jogo vem como
 * `id@start_time`, e um jogo remarcado conta de novo no horário novo.
 */
function unrevealedStarts(
  roundMatches: Match[],
  picks: GroupPicksResponse | null,
  now: number,
): string[] {
  if (!picks) return []
  const openOnServer = new Set(
    picks.predictions.filter((p) => p.locked !== 1).map((p) => p.match_id),
  )
  for (const [matchId, userIds] of Object.entries(picks.open_pickers ?? {})) {
    if (userIds.length > 0) openOnServer.add(matchId)
  }
  return roundMatches
    .filter((m) => openOnServer.has(m.id) && isMatchLocked(m, undefined, now))
    .map((m) => `${m.id}@${m.start_time}`)
}

/**
 * Linhas do card. Com o jogo travado, ou num grupo "Sempre visível", o card lista
 * todos os membros, e quem não palpitou entra como "sem palpite". Num grupo com
 * palpites ocultos, enquanto o servidor não confirma o travamento, o card mostra só
 * o que a API devolveu, que é o palpite do próprio usuário. A API esconde os outros
 * palpites até lá, e listar todos os membros marcaria como "sem palpite" quem já
 * palpitou.
 */
function buildPickRows(
  memberPicks: MemberPrediction[],
  members: GroupMember[],
  showRoster: boolean,
): PickRow[] {
  if (!showRoster) {
    return memberPicks.map((p) => ({ user_id: p.user_id, user_display: p.user_display, pick: p }))
  }
  const byUser = new Map(memberPicks.map((p) => [p.user_id, p]))
  const rows: PickRow[] = members.map((m) => {
    const pick = byUser.get(m.user_id) ?? null
    return { user_id: m.user_id, user_display: pick?.user_display ?? m.display, pick }
  })
  // A API lê os membros antes dos palpites e só devolve palpite de quem ainda é
  // membro na segunda leitura. Um palpite de fora da lista só chega se a pessoa
  // voltou ao grupo entre as duas leituras, porque o palpite de quem sai fica no banco.
  const rostered = new Set(members.map((m) => m.user_id))
  for (const p of memberPicks) {
    if (!rostered.has(p.user_id)) {
      rows.push({ user_id: p.user_id, user_display: p.user_display, pick: p })
    }
  }
  return rows
}

function MatchPicksCard({
  match,
  memberPicks,
  members,
  selfUserId,
  hidden,
  open,
  pickers,
}: {
  match: Match
  memberPicks: MemberPrediction[]
  members: GroupMember[]
  selfUserId: string
  hidden: boolean
  /** Jogo ainda aberto, pelo servidor e pelo relógio local. */
  open: boolean
  /** Membros que já palpitaram este jogo aberto. `null` quando não se sabe. */
  pickers: GroupMember[] | null
}) {
  const isFinished = match.status === 'finished'
  const serverLocked = serverConfirmsLock(match, memberPicks)
  const rows = buildPickRows(memberPicks, members, serverLocked || !hidden)

  return (
    <div className={styles.matchCard}>
      <div className={styles.matchHeader}>
        <span className={styles.team}>
          <img
            className={styles.crest}
            src={match.home_team_logo}
            alt={match.home_team_short_name}
            loading="lazy"
          />
          {match.home_team_short_name}
        </span>
        {isFinished ? (
          <span className={styles.finalScore}>
            {match.home_score ?? '–'} × {match.away_score ?? '–'}
          </span>
        ) : (
          <span className={styles.vs}>×</span>
        )}
        <span className={`${styles.team} ${styles.teamAway}`}>
          {match.away_team_short_name}
          <img
            className={styles.crest}
            src={match.away_team_logo}
            alt={match.away_team_short_name}
            loading="lazy"
          />
        </span>
      </div>

      {open && (
        <p className={styles.matchTime}>
          {match.postponed ? 'data a definir' : formatMatchDate(match.start_time)}
        </p>
      )}
      {open && pickers && (
        <MatchPickers
          pickers={pickers}
          memberCount={members.length}
          selfUserId={selfUserId}
          showInitials={hidden}
        />
      )}

      {rows.length > 0 ? (
        <ul className={styles.pickList}>
          {rows.map(({ user_id, user_display, pick: p }) => {
            const isSelf = user_id === selfUserId
            const total = p
              ? p.points_awarded + (p.penalty_points ?? 0) + (p.classified_points ?? 0)
              : 0
            return (
              <li key={user_id} className={`${styles.pickRow} ${isSelf ? styles.pickRowSelf : ''}`}>
                <span className={styles.pickName}>
                  {user_display}
                  {isSelf && <span className={styles.youTag}> (você)</span>}
                </span>
                {p ? (
                  <PickScore match={match} pick={p} />
                ) : (
                  <span className={styles.noPick}>sem palpite</span>
                )}
                {isFinished && (
                  <span
                    className={`${styles.pickPoints} ${total > 0 ? styles.pointsGreen : styles.pointsZero}`}
                  >
                    {total} pt
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        !open && (
          <p className={styles.hidden}>
            🔒 Os palpites dos outros membros aparecem quando o jogo começar.
          </p>
        )
      )}
    </div>
  )
}

function PickScore({ match, pick: p }: { match: Match; pick: MemberPrediction }) {
  // A draw pick is ambiguous on score alone in a knockout: the
  // penalty winner is what tells two equal scores apart.
  const showPenaltyPick = Boolean(match.decides_on_penalties) && p.predicted_penalty_winner != null
  const penaltyTeam =
    p.predicted_penalty_winner === 'home' ? match.home_team_short_name : match.away_team_short_name
  return (
    <span className={styles.pickScore}>
      {p.predicted_home_score} × {p.predicted_away_score}
      {p.predicted_classified && (
        <span>
          {' '}
          classificado:{' '}
          {p.predicted_classified === 'home'
            ? match.home_team_short_name
            : match.away_team_short_name}
        </span>
      )}
      {showPenaltyPick && (
        <PenaltyBadge team={penaltyTeam} tooltip="Vencedor previsto nos pênaltis" />
      )}
    </span>
  )
}

export default function GroupPicksTab({
  groupId,
  competitionId,
  groupName = '',
  predictionsVisibility = 'hidden',
}: GroupPicksTabProps) {
  const [matches, setMatches] = useState<Match[]>([])
  const [picks, setPicks] = useState<GroupPicksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roundIndex, setRoundIndex] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)

    Promise.all([
      fetchCompetitionMatches(competitionId),
      fetchGroupPredictions<GroupPicksResponse>(groupId),
    ])
      .then(([matchesData, picksData]) => {
        setMatches(matchesData.matches)
        setPicks(picksData)

        applyDefaultRoundFromMatches(matchesData.matches, matchesData.default_round, setRoundIndex)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId, competitionId])

  const {
    roundKeys,
    safeIndex,
    selectedRound,
    roundMatches,
    labelFor,
    knockoutRounds,
    prev,
    next,
  } = useMatchRounds(matches, roundIndex, setRoundIndex, {
    prev: 'click_group_picks_rodada_anterior',
    next: 'click_group_picks_proxima_rodada',
  })

  // O relógio também vira no início de cada jogo da rodada exibida.
  const now = useNow(
    TICK_MS,
    roundMatches.map((m) => m.start_time),
  )

  // No início do jogo, a resposta guardada ainda esconde os palpites dos outros. Num
  // grupo de palpites ocultos, a aba busca de novo na primeira virada do relógio depois
  // do início e, se a API ainda não travou, a cada tique por `REVEAL_RETRY_MS` a partir
  // dessa busca. Contar do início deixaria sem busca a aba que volta de segundo plano
  // depois do prazo.
  const firstRevealFetch = useRef(new Map<string, number>())
  const unrevealed =
    predictionsVisibility === 'hidden' ? unrevealedStarts(roundMatches, picks, now).join(',') : ''
  useEffect(() => {
    if (!unrevealed) return
    const firstFetch = firstRevealFetch.current
    const due = unrevealed
      .split(',')
      .map((key) => `${groupId}:${key}`)
      .filter((key) => now - (firstFetch.get(key) ?? now) < REVEAL_RETRY_MS)
    if (due.length === 0) return
    for (const key of due) if (!firstFetch.has(key)) firstFetch.set(key, now)
    let active = true
    invalidateApiCache(`groups:predictions:${groupId}`)
    fetchGroupPredictions<GroupPicksResponse>(groupId)
      .then((data) => {
        if (active) setPicks(data)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [unrevealed, now, groupId])

  if (loading) {
    return <p className={styles.loading}>Carregando palpites do grupo...</p>
  }

  if (error) {
    return <ErrorState message={error} />
  }

  if (matches.length === 0 || !picks) {
    return <p className={styles.empty}>Nenhum jogo encontrado para esta competição.</p>
  }

  // match_id → members' predictions (already filtered by the reveal rule on the API)
  const picksByMatch = new Map<string, MemberPrediction[]>()
  for (const p of picks.predictions) {
    if (!picksByMatch.has(p.match_id)) picksByMatch.set(p.match_id, [])
    picksByMatch.get(p.match_id)!.push(p)
  }

  const members = picks.members ?? []
  const openPickers = picks.open_pickers
  const hidden = predictionsVisibility === 'hidden'
  // O relógio local fecha o jogo no horário de início, mesmo que a resposta da API
  // seja de antes do travamento. A prova do servidor fecha o jogo com o relógio atrasado.
  const isOpen = (match: Match) =>
    !serverConfirmsLock(match, picksByMatch.get(match.id) ?? []) &&
    !isMatchLocked(match, undefined, now)
  const openMatches = roundMatches.filter(isOpen)
  const reminder = openPickers ? roundReminder(openMatches, members, openPickers) : null
  const showHiddenNotice = hidden && openMatches.length > 0

  const pickersOf = (match: Match): GroupMember[] | null => {
    if (!openPickers || !isOpen(match)) return null
    const picked = new Set(openPickers[match.id])
    return members.filter((m) => picked.has(m.user_id))
  }

  return (
    <div className={styles.root}>
      <RoundHeader
        id="picks-round-select"
        safeIndex={safeIndex}
        selectedRound={selectedRound}
        roundKeys={roundKeys}
        labelFor={labelFor}
        knockoutRounds={knockoutRounds}
        onPrev={prev}
        onNext={next}
        onSelect={(round) => {
          trackEvent('change_group_picks_rodada', { round })
          setRoundIndex(roundKeys.indexOf(round))
        }}
      />

      {(reminder || showHiddenNotice) && (
        <section className={styles.roundSummary} aria-label="Palpites da rodada">
          {reminder && (
            <RoundReminderSummary
              reminder={reminder}
              selfUserId={picks.self_user_id}
              groupId={groupId}
              groupName={groupName}
              round={selectedRound}
              roundLabel={labelFor(selectedRound)}
            />
          )}
          {showHiddenNotice && (
            <p className={styles.hidden}>
              Os palpites dos outros membros aparecem quando o jogo começar.
            </p>
          )}
        </section>
      )}

      <div className={styles.matchList}>
        {roundMatches.map((match) => (
          <MatchPicksCard
            key={match.id}
            match={match}
            memberPicks={picksByMatch.get(match.id) ?? []}
            members={members}
            selfUserId={picks.self_user_id}
            hidden={hidden}
            open={isOpen(match)}
            pickers={pickersOf(match)}
          />
        ))}
      </div>
    </div>
  )
}
