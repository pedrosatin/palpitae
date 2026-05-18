import { useEffect, useState } from 'react'
import { config } from '../config'
import MatchCard, { type Match, type Prediction } from './MatchCard'
import styles from './PredictionsTab.module.css'

interface PredictionsTabProps {
  groupId: string
  competitionId: string
}

type PredictionMap = Map<string, Prediction>

export default function PredictionsTab({
  groupId,
  competitionId,
}: PredictionsTabProps) {
  const [matches, setMatches] = useState<Match[]>([])
  const [predictions, setPredictions] = useState<PredictionMap>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className={styles.root}>
      {Array.from(rounds.entries()).map(([round, roundMatches]) => (
        <section key={round} className={styles.round}>
          <h3 className={styles.roundTitle}>Rodada {round}</h3>
          <div className={styles.matchList}>
            {roundMatches.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                prediction={predictions.get(match.id)}
                groupId={groupId}
                onSaved={handleSaved}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
