import { useEffect, useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { fetchCachedJson } from '../../lib/api-cache'
import { applyDefaultRound, isGroupStageRound } from '../../lib/rounds'
import MatchCard, { type Match, type Prediction } from '../MatchCard'
import PenaltyBadge from '../PenaltyBadge'
import Select from '../Select'
import Button from '../Button'
import RoundHeader from '../RoundHeader/RoundHeader'
import styles from './PredictionsTab.module.css'

interface PredictionsTabProps {
  groupId: string
  competitionId: string
  /** Group's points for an exact score. When 0, matches use the 1X2 button UI. */
  pointsExact?: number
}

type PredictionMap = Map<string, Prediction>

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

function ImportBar({
  otherGroups,
  importSourceId,
  setImportSourceId,
  handleImport,
  importing,
  importFeedback,
}: {
  otherGroups: { id: string; name: string }[]
  importSourceId: string
  setImportSourceId: (id: string) => void
  handleImport: () => void
  importing: boolean
  importFeedback: { ok: boolean; message: string } | null
}) {
  if (otherGroups.length === 0) return null
  return (
    <div className={styles.importBar}>
      <span className={styles.importLabel}>Importar palpites de:</span>
      <Select
        className={styles.importSelect}
        value={importSourceId}
        onChange={(e) => setImportSourceId(e.target.value)}
      >
        {otherGroups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </Select>
      <Button
        variant="primary"
        className={styles.importBtn}
        onClick={handleImport}
        disabled={importing || !importSourceId}
      >
        {importing ? 'Importando...' : 'Importar'}
      </Button>
      {importFeedback && (
        <span
          className={importFeedback.ok ? styles.importSuccess : styles.importError}
        >
          {importFeedback.message}
        </span>
      )}
    </div>
  )
}

function usePredictionsActions(
  groupId: string,
  predictions: PredictionMap,
  setPredictions: React.Dispatch<React.SetStateAction<PredictionMap>>,
  drafts: Map<string, { home: string; away: string }>,
  penaltyDrafts: Map<string, 'home' | 'away' | null>,
  roundMatches: Match[],
  selectedRound: string,
  handleSaved: (matchId: string, home: number, away: number, penaltyWinner: 'home' | 'away' | null) => void
) {
  const [savingAll, setSavingAll] = useState(false)
  const [savedAll, setSavedAll] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [importSourceId, setImportSourceId] = useState<string>('')
  const [importing, setImporting] = useState(false)
  const [importFeedback, setImportFeedback] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  function isLocked(match: Match): boolean {
    const p = predictions.get(match.id)
    return Boolean(p?.locked) || new Date() >= new Date(match.start_time)
  }

  function collectRoundDrafts() {
    const out: Array<{
      match_id: string
      predicted_home_score: number
      predicted_away_score: number
      predicted_penalty_winner?: 'home' | 'away' | null
    }> = []
    for (const m of roundMatches) {
      if (isLocked(m)) continue
      const draft = getMatchDraftToSave(
        m,
        predictions.get(m.id),
        drafts.get(m.id),
        penaltyDrafts.has(m.id),
        penaltyDrafts.get(m.id)
      )
      if (draft) out.push(draft)
    }
    return out
  }

  async function handleSaveAll() {
    const toSave = collectRoundDrafts()
    if (toSave.length === 0) return
    trackEvent('click_predictions_salvar_todos', { count: toSave.length, round: selectedRound })

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
          handleSaved(
            p.match_id,
            p.predicted_home_score,
            p.predicted_away_score,
            p.predicted_penalty_winner ?? null,
          )
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

  async function handleImport() {
    if (!importSourceId) return
    trackEvent('click_predictions_importar')
    setImporting(true)
    setImportFeedback(null)
    try {
      const res = await fetch(`${config.apiUrl}/predictions/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_group_id: importSourceId,
          target_group_id: groupId,
        }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        imported?: number
        locked_skipped?: number
      }
      if (!res.ok) throw new Error(data.error ?? 'Erro ao importar palpites')

      // Refresh predictions after import
      const predsRes = await fetch(
        `${config.apiUrl}/predictions?group_id=${encodeURIComponent(groupId)}`,
        { credentials: 'include' },
      )
      const predsData = (await predsRes.json()) as { predictions: Prediction[] }
      const map = new Map<string, Prediction>()
      for (const p of predsData.predictions) map.set(p.match_id, p)
      setPredictions(map)

      const imported = data.imported ?? 0
      const skipped = data.locked_skipped ?? 0
      const msg =
        skipped > 0
          ? `${imported} palpite(s) importado(s). ${skipped} já bloqueado(s) foram ignorados.`
          : `${imported} palpite(s) importado(s) com sucesso!`
      setImportFeedback({ ok: true, message: msg })
      setTimeout(() => setImportFeedback(null), 4000)
    } catch (e) {
      setImportFeedback({ ok: false, message: (e as Error).message })
    } finally {
      setImporting(false)
    }
  }

  return {
    savingAll,
    savedAll,
    bulkError,
    importSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    collectRoundDrafts,
    handleSaveAll,
    handleImport,
    isLocked,
  }
}

export default function PredictionsTab({
  groupId,
  competitionId,
  pointsExact = 3,
}: PredictionsTabProps) {
  const [matches, setMatches] = useState<Match[]>([])
  const [predictions, setPredictions] = useState<PredictionMap>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roundIndex, setRoundIndex] = useState(0)
  // Current input drafts reported by each MatchCard, so we can "Salvar todos".
  const [drafts, setDrafts] = useState<
    Map<string, { home: string; away: string }>
  >(new Map())
  // Penalty-winner drafts (match_id -> 'home' | 'away' | null) for shootout draws.
  const [penaltyDrafts, setPenaltyDrafts] = useState<
    Map<string, 'home' | 'away' | null>
  >(new Map())
  const [otherGroups, setOtherGroups] = useState<
    { id: string; name: string }[]
  >([])

  // Group matches by round
  const rounds = new Map<string, Match[]>()
  for (const m of matches) {
    const key = m.round
    if (!rounds.has(key)) rounds.set(key, [])
    rounds.get(key)!.push(m)
  }

  const roundKeys = Array.from(rounds.keys())
  const labelFor = (r: string) => rounds.get(r)?.[0]?.round_label ?? r
  const safeIndex = Math.max(0, Math.min(roundIndex, roundKeys.length - 1))
  const selectedRound = roundKeys[safeIndex] ?? ''
  const roundMatches = rounds.get(selectedRound) ?? []

  function handleSaved(
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) {
    setPredictions((prev) => {
      const next = new Map(prev)
      const existing = prev.get(matchId)
      next.set(matchId, {
        id: existing?.id ?? '',
        match_id: matchId,
        predicted_home_score: home,
        predicted_away_score: away,
        predicted_penalty_winner: penaltyWinner,
        points_awarded: existing?.points_awarded ?? 0,
        penalty_points: existing?.penalty_points ?? 0,
        locked: 0,
        updated_at: new Date().toISOString(),
      })
      return next
    })
  }

  const {
    savingAll,
    savedAll,
    bulkError,
    importSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    collectRoundDrafts,
    handleSaveAll,
    handleImport,
  } = usePredictionsActions(
    groupId,
    predictions,
    setPredictions,
    drafts,
    penaltyDrafts,
    roundMatches,
    selectedRound,
    handleSaved
  )

  const pendingCount = collectRoundDrafts().length

  useEffect(() => {
    fetchCachedJson(
      'groups:list',
      () =>
        fetch(`${config.apiUrl}/groups`, { credentials: 'include' }).then(
          (r) => {
            if (!r.ok) throw new Error('Erro ao carregar grupos')
            return r.json() as Promise<{
              groups: Array<{
                id: string
                name: string
                competition_id: string
              }>
            }>
          },
        ),
      30_000,
    )
      .then((data) => {
        const siblings = data.groups.filter(
          (g) => g.competition_id === competitionId && g.id !== groupId,
        )
        setOtherGroups(siblings)
        if (siblings.length > 0) setImportSourceId(siblings[0].id)
      })
      .catch(() => {})
  }, [groupId, competitionId])

  useEffect(() => {
    setLoading(true)
    setError(null)

    Promise.all([
      fetchCachedJson(
        `matches:${competitionId}`,
        () =>
          fetch(
            `${config.apiUrl}/matches?competition_id=${encodeURIComponent(competitionId)}`,
            {
              credentials: 'include',
            },
          ).then((r) => {
            if (!r.ok) throw new Error('Erro ao carregar jogos')
            return r.json() as Promise<{ matches: Match[]; default_round: string | null }>
          }),
        30_000,
      ),
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

        const keys = [...new Set(matchesData.matches.map((m) => m.round))]
        applyDefaultRound(matchesData.default_round, keys, setRoundIndex)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId, competitionId])

  function handleSaved(
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) {
    setPredictions((prev) => {
      const next = new Map(prev)
      const existing = prev.get(matchId)
      next.set(matchId, {
        id: existing?.id ?? '',
        match_id: matchId,
        predicted_home_score: home,
        predicted_away_score: away,
        predicted_penalty_winner: penaltyWinner,
        points_awarded: existing?.points_awarded ?? 0,
        penalty_points: existing?.penalty_points ?? 0,
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

  function handlePenaltyDraftChange(
    matchId: string,
    winner: 'home' | 'away' | null,
  ) {
    setPenaltyDrafts((prev) => {
      const next = new Map(prev)
      next.set(matchId, winner)
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

  function prev() {
    trackEvent('click_predictions_rodada_anterior', { round: roundKeys[Math.max(0, safeIndex - 1)] })
    setRoundIndex((i) => Math.max(0, i - 1))
  }

  function next() {
    trackEvent('click_predictions_proxima_rodada', { round: roundKeys[Math.min(roundKeys.length - 1, safeIndex + 1)] })
    setRoundIndex((i) => Math.min(roundKeys.length - 1, i + 1))
  }

  return (
    <div className={styles.root}>
      <ImportBar
        otherGroups={otherGroups}
        importSourceId={importSourceId}
        setImportSourceId={setImportSourceId}
        handleImport={handleImport}
        importing={importing}
        importFeedback={importFeedback}
      />
      <RoundHeader
        id="predictions-round-select"
        roundKeys={roundKeys}
        safeIndex={safeIndex}
        selectedRound={selectedRound}
        labelFor={labelFor}
        onPrev={prev}
        onNext={next}
        onSelect={(round) => {
          trackEvent('change_predictions_rodada', { round })
          setRoundIndex(roundKeys.indexOf(round))
        }}
      />

      <div className={styles.saveAllBar}>
        {bulkError && <span className={styles.error}>{bulkError}</span>}
        <Button
          variant="primary"
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
        </Button>
      </div>

      {groupedRoundMatches(roundMatches).map(([groupName, groupMatches], idx) => (
        <div key={`${groupName ?? '__no_group'}-${idx}`} className={styles.matchGroup}>
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
                outcomeOnly={pointsExact === 0}
                onSaved={handleSaved}
                onDraftChange={handleDraftChange}
                onPenaltyDraftChange={handlePenaltyDraftChange}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function getMatchDraftToSave(
  m: Match,
  p: Prediction | undefined,
  d: { home: string; away: string } | undefined,
  hasPenaltyDraft: boolean,
  penaltyDraft: 'home' | 'away' | null | undefined
) {
  if (!d && !hasPenaltyDraft) return null
  const homeStr = d?.home ?? (p ? String(p.predicted_home_score) : '0')
  const awayStr = d?.away ?? (p ? String(p.predicted_away_score) : '0')
  if (homeStr === '' || awayStr === '') return null
  const home = Number(homeStr)
  const away = Number(awayStr)

  const eligibleDraw = home === away && Boolean(m.decides_on_penalties)
  const penaltyWinner: 'home' | 'away' | null = eligibleDraw
    ? hasPenaltyDraft
      ? (penaltyDraft ?? null)
      : (p?.predicted_penalty_winner ?? null)
    : null
  if (eligibleDraw && penaltyWinner === null) return null

  const scoreChanged = !p || home !== p.predicted_home_score || away !== p.predicted_away_score
  const penaltyChanged = penaltyWinner !== (p?.predicted_penalty_winner ?? null)

  if (scoreChanged || penaltyChanged) {
    return {
      match_id: m.id,
      predicted_home_score: home,
      predicted_away_score: away,
      predicted_penalty_winner: penaltyWinner,
    }
  }
  return null
}
