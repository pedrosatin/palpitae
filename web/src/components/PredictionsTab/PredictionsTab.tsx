import { trackEvent } from '../../analytics/ga'
import Button from '../Button'
import ErrorState from '../ErrorState'
import MatchCard, { type Match } from '../MatchCard'
import RoundHeader from '../RoundHeader/RoundHeader'
import Select from '../Select'
import { usePredictionsTab } from './usePredictionsTab'
import styles from './PredictionsTab.module.css'

interface PredictionsTabProps {
  groupId: string
  competitionId: string
  /** Group's points for an exact score. When 0, matches use the 1X2 button UI. */
  pointsExact?: number
}

export default function PredictionsTab({
  groupId,
  competitionId,
  pointsExact = 3,
}: PredictionsTabProps) {
  const {
    matches,
    predictions,
    loading,
    error,
    roundKeys,
    safeIndex,
    selectedRound,
    roundMatches,
    labelFor,
    postponedByRound,
    prev,
    next,
    setRoundIndex,
    savingAll,
    savedAll,
    bulkError,
    pendingCount,
    handleSaveAll,
    otherGroups,
    importSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    handleImport,
    handleSaved,
    handleDraftChange,
    handlePenaltyDraftChange,
  } = usePredictionsTab(groupId, competitionId)

  // Avisa sobre UMA rodada adiada: a mais próxima ANTES da aberta.
  //
  // Olhar pra trás porque jogo adiado é sempre passado — ele guarda o horário
  // original, que já venceu. E mostrar só a mais próxima porque o Brasileirão
  // acumula adiados distantes (a rodada 4 tem um Flamengo×Mirassol parado desde
  // fevereiro): avisar do mais antigo primeiro fazia o usuário pular 17 rodadas
  // pra trás e só então descobrir que a 21 também tinha. O seletor continua
  // marcando todas, então nada some — só sai do caminho.
  //
  // Estando numa rodada adiada não há aviso nenhum: os cards já mostram o badge,
  // e apontar para a adiada anterior recriaria o encadeamento (22 → 21 → 4).
  const postponedBefore = postponedByRound.has(selectedRound)
    ? []
    : roundKeys.slice(0, Math.max(0, safeIndex)).filter((round) => postponedByRound.has(round))
  const previousPostponedRound = postponedBefore[postponedBefore.length - 1]
  const postponedElsewhere = previousPostponedRound
    ? { round: previousPostponedRound, count: postponedByRound.get(previousPostponedRound)! }
    : undefined

  if (loading) {
    return <p className={styles.loading}>Carregando jogos...</p>
  }

  if (error) {
    return <ErrorState message={error} />
  }

  if (matches.length === 0) {
    return <p className={styles.empty}>Nenhum jogo encontrado para esta competição.</p>
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
      {otherGroups.length > 0 && (
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
            size="sm"
            className={styles.importBtn}
            onClick={handleImport}
            disabled={importing || !importSourceId}
          >
            {importing ? 'Importando...' : 'Importar'}
          </Button>
          {importFeedback && (
            <span className={importFeedback.ok ? styles.importSuccess : styles.importError}>
              {importFeedback.message}
            </span>
          )}
        </div>
      )}
      <RoundHeader
        id="predictions-round-select"
        roundKeys={roundKeys}
        safeIndex={safeIndex}
        selectedRound={selectedRound}
        labelFor={labelFor}
        onPrev={prev}
        onNext={next}
        postponedByRound={postponedByRound}
        onSelect={(round) => {
          trackEvent('change_predictions_rodada', { round })
          setRoundIndex(roundKeys.indexOf(round))
        }}
      />

      {/* Atalho para a rodada com jogo adiado. Sem isso o palpite reaberto fica
          invisível: a rodada não é o default e o usuário não tem por que visitá-la. */}
      {postponedElsewhere && (
        <p className={styles.postponedHint}>
          <strong>{labelFor(postponedElsewhere.round)}</strong> tem {postponedElsewhere.count} jogo
          {postponedElsewhere.count > 1 ? 's' : ''} adiado
          {postponedElsewhere.count > 1 ? 's' : ''} — o palpite segue aberto.{' '}
          <button
            type="button"
            className={styles.postponedHintLink}
            onClick={() => {
              trackEvent('click_predictions_rodada_adiada', {
                round: postponedElsewhere.round,
              })
              setRoundIndex(roundKeys.indexOf(postponedElsewhere.round))
            }}
          >
            Ver rodada
          </button>
        </p>
      )}

      <div className={styles.saveAllBar}>
        {bulkError && <span className={styles.error}>{bulkError}</span>}
        <Button
          size="sm"
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

      {groupedRoundMatches(roundMatches).map(([groupName, groupMatches]) => (
        <div key={groupName ?? '__no_group'} className={styles.matchGroup}>
          {groupName && <h3 className={styles.groupHeader}>Grupo {groupName}</h3>}
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
