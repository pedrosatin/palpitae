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
  // Current input drafts reported by each MatchCard, so we can "Salvar todos".
  const [drafts, setDrafts] = useState<Map<string, { home: string; away: string }>>(
    new Map(),
  )
  const [savingAll, setSavingAll] = useState(false)
  const [savedAll, setSavedAll] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

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

  function handleDraftChange(matchId: string, home: string, away: string) {
    setDrafts((prev) => {
      const next = new Map(prev)
      next.set(matchId, { home, away })
      return next
    })
  }

  function isLocked(match: Match): boolean {
    const p = predictions.get(match.id)
    return Boolean(p?.locked) || new Date() >= new Date(match.start_time)
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

  // Editable, non-empty drafts of the visible round that differ from what's saved.
  function collectRoundDrafts() {
    const out: Array<{
      match_id: string
      predicted_home_score: number
      predicted_away_score: number
    }> = []
    for (const m of roundMatches) {
      if (isLocked(m)) continue
      const d = drafts.get(m.id)
      if (!d || d.home === '' || d.away === '') continue
      const home = Number(d.home)
      const away = Number(d.away)
      const p = predictions.get(m.id)
      const changed =
        !p ||
        home !== p.predicted_home_score ||
        away !== p.predicted_away_score
      if (changed) {
        out.push({
          match_id: m.id,
          predicted_home_score: home,
          predicted_away_score: away,
        })
      }
    }
    return out
  }

  async function handleSaveAll() {
    const toSave = collectRoundDrafts()
    if (toSave.length === 0) return

    setSavingAll(true)
    setSavedAll(false)
    setBulkError(null)

    try {
      const res = await fetch(`${config.apiUrl}/predictions/bulk`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId, predictions: toSave }),
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Erro ao salvar palpites')
      }

      const data = (await res.json()) as { saved: string[] }
      const savedSet = new Set(data.saved)
      for (const p of toSave) {
        if (savedSet.has(p.match_id)) {
          handleSaved(p.match_id, p.predicted_home_score, p.predicted_away_score)
        }
      }

      setSavedAll(true)
      setTimeout(() => setSavedAll(false), 2500)
    } catch (e) {
      setBulkError((e as Error).message)
    } finally {
      setSavingAll(false)
    }
  }

  const pendingCount = collectRoundDrafts().length

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

      <div className={styles.saveAllBar}>
        {bulkError && <span className={styles.error}>{bulkError}</span>}
        <button
          className={`${styles.saveAllBtn} ${savedAll ? styles.saveAllBtnSaved : ''}`}
          onClick={handleSaveAll}
          disabled={pendingCount === 0 || savingAll}
        >
          {savingAll
            ? 'Salvando...'
            : savedAll
              ? 'Tudo salvo!'
              : pendingCount > 0
                ? `Salvar todos (${pendingCount})`
                : 'Salvar todos'}
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
                onDraftChange={handleDraftChange}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
