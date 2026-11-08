import { trackEvent } from '../../analytics/ga'
import { useNow } from '../../hooks/useNow'
import { leftoverMatchesText } from '../../lib/rounds'
import Button from '../Button'
import ErrorState from '../ErrorState'
import MatchCard, { type Match } from '../MatchCard'
import RoundHeader from '../RoundHeader/RoundHeader'
import PredictionsImportBar from './PredictionsImportBar'
import PredictionsReplicateBar from './PredictionsReplicateBar'
import RoundProgress from './RoundProgress'
import RoundSummary from './RoundSummary'
import PredictionsFeedback from '../PredictionsFeedback/PredictionsFeedback'
import { usePredictionsTab } from './usePredictionsTab'
import styles from './PredictionsTab.module.css'

/** Intervalo do relógio da aba. O "fecha em ..." mostra minutos. */
const TICK_MS = 30_000

interface PredictionsTabProps {
  groupId: string
  /** Nome do grupo, usado no cartão da rodada. */
  groupName?: string
  competitionId: string
  /** Liga a guarda dos rascunhos não salvos no navegador, numa chave por usuário e grupo. */
  userId?: string
  /** Group's points for an exact score. When 0, matches use the 1X2 button UI. */
  pointsExact?: number
  /** Rodada em que a aba abre no lugar da padrão, vinda do `?rodada=` do link. */
  initialRound?: string | null
  /** Chamado depois que a aba aplica `initialRound` na carga dos jogos. */
  onInitialRoundApplied?: () => void
}

function leg1Context(
  match: Match,
  predictions: Map<string, import('../MatchCard').Prediction>,
  roundMatches: Match[],
  drafts: Map<string, { home: string; away: string }>,
) {
  const saved = match.leg1_match_id ? predictions.get(match.leg1_match_id) : undefined
  const draft =
    match.leg1_match_id && roundMatches.some((m) => m.id === match.leg1_match_id)
      ? drafts.get(match.leg1_match_id)
      : undefined
  const pending =
    draft &&
    draft.home !== '' &&
    draft.away !== '' &&
    (!saved ||
      Number(draft.home) !== saved.predicted_home_score ||
      Number(draft.away) !== saved.predicted_away_score)
  return {
    pending: Boolean(pending),
    prediction: pending
      ? {
          ...saved,
          id: '',
          match_id: match.leg1_match_id!,
          predicted_home_score: Number(draft.home),
          predicted_away_score: Number(draft.away),
          points_awarded: 0,
          locked: 0 as const,
          updated_at: '',
        }
      : saved,
  }
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

export default function PredictionsTab({
  groupId,
  groupName,
  competitionId,
  userId,
  pointsExact = 3,
  initialRound,
  onInitialRoundApplied,
}: PredictionsTabProps) {
  const {
    unsavedDrafts,
    unsavedRounds,
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
    rescheduledByRound,
    prev,
    next,
    setRoundIndex,
    savingAll,
    savedAll,
    hasSavedPredictions,
    bulkError,
    pendingCount,
    handleSaveAll,
    showSaveBar,
    importCompleted,
    importExpanded,
    setImportExpanded,
    otherGroups,
    importOptions,
    importPending,
    importSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    importedFromName,
    handleImport,
    handleSaved,
    replicateTargets,
    replicateEnabled,
    replicating,
    replicateFeedback,
    handleReplicateToggle,
    handleDraftChange,
    handlePenaltyDraftChange,
  } = usePredictionsTab(groupId, competitionId, userId, initialRound, onInitialRoundApplied)
  // Um relógio só para o cabeçalho e os cards. Quando um jogo começa com a aba
  // aberta, o cabeçalho tira o jogo e o card trava no mesmo tique.
  const now = useNow(TICK_MS)

  // Avisa sobre UMA rodada com palpite aberto fora de hora: a mais próxima ANTES
  // da aberta. Entram jogos adiados (ADR-013) e jogos remarcados para o futuro em
  // rodadas que ficaram para trás (ADR-019): nos dois casos a rodada não é o
  // default e o usuário não tem por que visitá-la.
  //
  // Olhar pra trás porque essas rodadas são sempre antigas. E mostrar só a mais
  // próxima porque o Brasileirão acumula adiados distantes (a rodada 4 tem um
  // Flamengo×Mirassol parado desde fevereiro): avisar do mais antigo primeiro
  // fazia o usuário pular 17 rodadas pra trás e só então descobrir que a 21
  // também tinha. O seletor continua marcando todas, então nada some — só sai
  // do caminho.
  //
  // Estando numa dessas rodadas não há aviso nenhum: os cards já mostram o jogo,
  // e apontar para a anterior recriaria o encadeamento (22 → 21 → 4).
  const hasLeftover = (round: string) =>
    postponedByRound.has(round) || rescheduledByRound.has(round)
  const leftoverBefore = hasLeftover(selectedRound)
    ? []
    : roundKeys.slice(0, Math.max(0, safeIndex)).filter(hasLeftover)
  const previousLeftoverRound = leftoverBefore[leftoverBefore.length - 1]
  const leftoverElsewhere = previousLeftoverRound
    ? {
        round: previousLeftoverRound,
        text: leftoverMatchesText(
          postponedByRound.get(previousLeftoverRound) ?? 0,
          rescheduledByRound.get(previousLeftoverRound) ?? 0,
        ),
      }
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

  return (
    <div className={`${styles.root} ${showSaveBar ? styles.rootWithSaveBar : ''}`}>
      <PredictionsImportBar
        {...{
          otherGroups,
          importOptions,
          importPending,
          importCompleted,
          importFeedback,
          importedFromName,
          importExpanded,
          importSourceId,
          setImportSourceId,
          importing,
          handleImport,
          setImportExpanded,
        }}
      />
      <div className={styles.roundHeading}>
        <RoundHeader
          id="predictions-round-select"
          roundKeys={roundKeys}
          safeIndex={safeIndex}
          selectedRound={selectedRound}
          labelFor={labelFor}
          onPrev={prev}
          onNext={next}
          postponedByRound={postponedByRound}
          rescheduledByRound={rescheduledByRound}
          unsavedRounds={unsavedRounds}
          onSelect={(round) => {
            trackEvent('change_predictions_rodada', { round })
            setRoundIndex(roundKeys.indexOf(round))
          }}
        />
        <RoundProgress roundMatches={roundMatches} predictions={predictions} now={now} />
      </div>

      <RoundSummary
        groupId={groupId}
        groupName={groupName}
        roundLabel={labelFor(selectedRound)}
        roundMatches={roundMatches}
        predictions={predictions}
        pointsExact={pointsExact}
      />

      {/* Atalho para a rodada com jogo adiado ou remarcado. Sem isso o palpite
          aberto fica invisível: a rodada não é o default e o usuário não tem por
          que visitá-la. */}
      {leftoverElsewhere && (
        <p className={styles.postponedHint}>
          <strong>{labelFor(leftoverElsewhere.round)}</strong> tem {leftoverElsewhere.text}. O
          palpite segue aberto.{' '}
          <button
            type="button"
            className={styles.postponedHintLink}
            onClick={() => {
              trackEvent('click_predictions_rodada_adiada', {
                round: leftoverElsewhere.round,
              })
              setRoundIndex(roundKeys.indexOf(leftoverElsewhere.round))
            }}
          >
            Ver rodada
          </button>
        </p>
      )}

      <PredictionsReplicateBar
        {...{
          replicateTargets,
          replicateEnabled,
          replicating,
          replicateFeedback,
          handleReplicateToggle,
        }}
        showOption={showSaveBar}
      />

      {showSaveBar && (
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
      )}

      {hasSavedPredictions && <PredictionsFeedback />}

      {groupedRoundMatches(roundMatches).map(([groupName, groupMatches]) => (
        <div key={groupName ?? '__no_group'} className={styles.matchGroup}>
          {groupName && <h3 className={styles.groupHeader}>Grupo {groupName}</h3>}
          <div className={styles.matchList}>
            {groupMatches.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                prediction={predictions.get(match.id)}
                draft={unsavedDrafts.drafts.get(match.id)}
                penaltyDraft={unsavedDrafts.penaltyDrafts.get(match.id)}
                leg1Prediction={
                  leg1Context(match, predictions, roundMatches, unsavedDrafts.drafts).prediction
                }
                leg1Pending={
                  leg1Context(match, predictions, roundMatches, unsavedDrafts.drafts).pending
                }
                leg1Match={
                  match.leg1_match_id
                    ? matches.find((m) => m.id === match.leg1_match_id)
                    : undefined
                }
                groupId={groupId}
                outcomeOnly={pointsExact === 0}
                onSaved={handleSaved}
                onDraftChange={handleDraftChange}
                onPenaltyDraftChange={handlePenaltyDraftChange}
                now={now}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
