import { trackEvent } from '../../analytics/ga'
import { groupConsecutiveBy } from '../../lib/groupConsecutiveBy'
import { leftoverMatchesText, previousLeftoverRound } from '../../lib/rounds'
import ErrorState from '../ErrorState'
import MatchCard, { type Match, type Prediction } from '../MatchCard'
import RoundHeader from '../RoundHeader/RoundHeader'
import PredictionsImportBar from './PredictionsImportBar'
import PredictionsReplicateBar from './PredictionsReplicateBar'
import RoundProgress from './RoundProgress'
import RoundSummary from './RoundSummary'
import SaveAllBar from './SaveAllBar'
import PredictionsFeedback from '../PredictionsFeedback/PredictionsFeedback'
import { usePredictionsTab } from './usePredictionsTab'
import { findLeg2 } from '../../lib/tieSummary'
import styles from './PredictionsTab.module.css'

interface PredictionsTabProps {
  groupId: string
  groupName?: string
  competitionId: string
  userId?: string
  pointsExact?: number
  initialRound?: string | null
  onInitialRoundApplied?: () => void
  inviteCode?: string | null
  publicId?: string | null
  isOwner?: boolean
}

function leg1Context(
  match: Match,
  predictions: Map<string, Prediction>,
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
  return groupConsecutiveBy(ms, (m) => m.group_name ?? null)
}

export default function PredictionsTab({
  groupId,
  groupName,
  competitionId,
  userId,
  pointsExact = 3,
  initialRound,
  onInitialRoundApplied,
  inviteCode,
  publicId,
  isOwner = false,
}: PredictionsTabProps) {
  const {
    now,
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
    knockoutRounds,
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
    hasOpenMatch,
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
    handleCardSave,
    hasRawDraft,
    cardErrors,
    replicateTargets,
    replicateOverflow,
    replicateEnabled,
    replicating,
    replicateFeedback,
    handleReplicateToggle,
    canRetryReplicate,
    retryReplicate,
    handleDraftChange,
    handlePenaltyDraftChange,
  } = usePredictionsTab(
    groupId,
    competitionId,
    userId,
    initialRound,
    onInitialRoundApplied,
    pointsExact,
  )
  const leftoverRound = previousLeftoverRound(
    roundKeys,
    safeIndex,
    postponedByRound,
    rescheduledByRound,
  )
  const leftoverElsewhere = leftoverRound
    ? {
        round: leftoverRound,
        text: leftoverMatchesText(
          postponedByRound.get(leftoverRound) ?? 0,
          rescheduledByRound.get(leftoverRound) ?? 0,
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

  const hasTallSaveBar = replicating || replicateFeedback.length > 0 || bulkError !== null

  return (
    <div
      className={`${styles.root} ${showSaveBar ? styles.rootWithSaveBar : ''} ${hasTallSaveBar ? styles.rootWithSaveBarTall : ''}`}
    >
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
          knockoutRounds={knockoutRounds}
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
        selectedRound={selectedRound}
        roundMatches={roundMatches}
        predictions={predictions}
        pointsExact={pointsExact}
        inviteCode={inviteCode}
        publicId={publicId}
        isOwner={isOwner}
      />

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
          replicateOverflow,
          replicateEnabled,
          handleReplicateToggle,
        }}
        showOption={hasOpenMatch}
      />

      <SaveAllBar
        showSaveBar={showSaveBar}
        replicating={replicating}
        replicateFeedback={replicateFeedback}
        canRetryReplicate={canRetryReplicate}
        retryReplicate={retryReplicate}
        bulkError={bulkError}
        savedAll={savedAll}
        handleSaveAll={handleSaveAll}
        pendingCount={pendingCount}
        savingAll={savingAll}
      />

      {hasSavedPredictions && <PredictionsFeedback />}

      {groupedRoundMatches(roundMatches).map(([groupName, groupMatches]) => (
        <div key={groupName ?? '__no_group'} className={styles.matchGroup}>
          {groupName && <h3 className={styles.groupHeader}>Grupo {groupName}</h3>}
          <div className={styles.matchList}>
            {groupMatches.map((match) => {
              const leg1 = leg1Context(match, predictions, roundMatches, unsavedDrafts.drafts)
              return (
                <MatchCard
                  key={match.id}
                  match={match}
                  prediction={predictions.get(match.id)}
                  draft={unsavedDrafts.drafts.get(match.id)}
                  penaltyDraft={unsavedDrafts.penaltyDrafts.get(match.id)}
                  leg1Prediction={leg1.prediction}
                  leg1Pending={leg1.pending}
                  leg1Match={
                    match.leg1_match_id
                      ? matches.find((m) => m.id === match.leg1_match_id)
                      : undefined
                  }
                  leg2Match={findLeg2(match, matches)}
                  groupId={groupId}
                  outcomeOnly={pointsExact === 0}
                  onSaved={handleSaved}
                  onSave={handleCardSave}
                  hasDraft={hasRawDraft(match.id)}
                  externalError={cardErrors.get(match.id) ?? null}
                  onDraftChange={handleDraftChange}
                  onPenaltyDraftChange={handlePenaltyDraftChange}
                  now={now}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
