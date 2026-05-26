import { useEffect, useState } from 'react'
import { config } from '../../config'
import MatchCard, { type Match, type Prediction } from '../MatchCard'
import styles from './PredictionsTab.module.css'

interface PredictionsTabProps {
  groupId: string
  competitionId: string
}

type PredictionMap = Map<string, Prediction>

function defaultRoundIndex(rounds: Map<string, Match[]>): number {
  const keys = Array.from(rounds.keys())
  const idx = keys.findIndex((k) =>
    rounds.get(k)!.some((m) => m.status === 'scheduled' || m.status === 'live'),
  )
  return idx >= 0 ? idx : keys.length - 1
}

export default function PredictionsTab({
  groupId,
  competitionId,
}: PredictionsTabProps) {
  const [matches, setMatches] = useState<Match[]>([])
  const [predictions, setPredictions] = useState<PredictionMap>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roundIndex, setRoundIndex] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)

    Promise.all([
      fetch(
        `${config.apiUrl}/matches?competition_id=${encodeURIComponent(competitionId)}`,
        {
          credentials: 'include',
        },
      ).then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar jogos')
        return r.json() as Promise<{ matches: Match[] }>
      }),
      fetch(
        `${config.apiUrl}/predictions?group_id=${encodeURIComponent(groupId)}`,
        {
          credentials: 'include',
        },
      ).then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar palpites')
        return r.json() as Promise<{ predictions: Prediction[] }>
      }),
    ])
      .then(([matchesData, predictionsData]) => {
        setMatches(matchesData.matches)
        const map = new Map<string, Prediction>()
        for (const p of predictionsData.predictions) map.set(p.match_id, p)
        setPredictions(map)

        // compute rounds here so we can pick the default
        const r = new Map<string, Match[]>()
        for (const m of matchesData.matches) {
          if (!r.has(m.round)) r.set(m.round, [])
          r.get(m.round)!.push(m)
        }
        setRoundIndex(defaultRoundIndex(r))
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId, competitionId])

  function handleSaved(matchId: string, home: number, away: number) {
    setPredictions((prev) => {
      const next = new Map(prev)
      const existing = prev.get(matchId)
      next.set(matchId, {
        id: existing?.id ?? '',
        match_id: matchId,
        predicted_home_score: home,
        predicted_away_score: away,
        points_awarded: existing?.points_awarded ?? 0,
        locked: 0,
        updated_at: new Date().toISOString(),
      })
      return next
    })
  }

  if (loading) {
    return <p className={styles.loading}>Carregando jogos...</p>
  }

  if (error) {
    return <p className={styles.error}>{error}</p>
  }

  if (matches.length === 0) {
    return (
      <p className={styles.empty}>
        Nenhum jogo encontrado para esta competição.
      </p>
    )
  }

  // Group matches by round
  const rounds = new Map<string, Match[]>()
  for (const m of matches) {
    const key = m.round
    if (!rounds.has(key)) rounds.set(key, [])
    rounds.get(key)!.push(m)
  }

  const roundKeys = Array.from(rounds.keys())
  const safeIndex = Math.min(roundIndex, roundKeys.length - 1)
  const selectedRound = roundKeys[safeIndex]
  const roundMatches = rounds.get(selectedRound) ?? []

  function prev() {
    setRoundIndex((i) => Math.max(0, i - 1))
  }

  function next() {
    setRoundIndex((i) => Math.min(roundKeys.length - 1, i + 1))
  }

  function groupedRoundMatches(ms: Match[]): [string | null, Match[]][] {
    const result: [string | null, Match[]][] = []
    for (const m of ms) {
      const key = m.group_name ?? null
      const last = result[result.length - 1]
      if (last && last[0] === key) {
        last[1].push(m)
      } else {
        result.push([key, [m]])
      }
    }
    return result
  }

  return (
    <div className={styles.root}>
      <div className={styles.roundNav}>
        <button
          className={styles.navBtn}
          onClick={prev}
          disabled={safeIndex === 0}
          aria-label="Rodada anterior"
        >
          ‹ Anterior
        </button>
        <select
          className={styles.roundSelect}
          value={selectedRound}
          onChange={(e) => setRoundIndex(roundKeys.indexOf(e.target.value))}
        >
          {roundKeys.map((r) => (
            <option key={r} value={r}>
              Rodada {r}
            </option>
          ))}
        </select>
        <button
          className={styles.navBtn}
          onClick={next}
          disabled={safeIndex === roundKeys.length - 1}
          aria-label="Próxima rodada"
        >
          Próxima ›
        </button>
      </div>

      {groupedRoundMatches(roundMatches).map(([groupName, groupMatches]) => (
        <div key={groupName ?? '__no_group'} className={styles.matchGroup}>
          {groupName && (
            <h3 className={styles.groupHeader}>Grupo {groupName}</h3>
          )}
          <div className={styles.matchList}>
            {groupMatches.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                prediction={predictions.get(match.id)}
                groupId={groupId}
                onSaved={handleSaved}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
