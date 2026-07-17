import { trackEvent } from "../../analytics/ga";
import ErrorState from "../ErrorState";
import MatchCard, { type Match } from "../MatchCard";
import RoundHeader from "../RoundHeader/RoundHeader";
import { usePredictionsTab } from "./usePredictionsTab";
import styles from "./PredictionsTab.module.css";

interface PredictionsTabProps {
  groupId: string;
  competitionId: string;
  /** Group's points for an exact score. When 0, matches use the 1X2 button UI. */
  pointsExact?: number;
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
  } = usePredictionsTab(groupId, competitionId);

  if (loading) {
    return <p className={styles.loading}>Carregando jogos...</p>;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  if (matches.length === 0) {
    return (
      <p className={styles.empty}>
        Nenhum jogo encontrado para esta competição.
      </p>
    );
  }

  function groupedRoundMatches(ms: Match[]): [string | null, Match[]][] {
    const result: [string | null, Match[]][] = [];
    for (const m of ms) {
      const key = m.group_name ?? null;
      const last = result[result.length - 1];
      if (last && last[0] === key) {
        last[1].push(m);
      } else {
        result.push([key, [m]]);
      }
    }
    return result;
  }

  return (
    <div className={styles.root}>
      {otherGroups.length > 0 && (
        <div className={styles.importBar}>
          <span className={styles.importLabel}>Importar palpites de:</span>
          <select
            className={styles.importSelect}
            value={importSourceId}
            onChange={(e) => setImportSourceId(e.target.value)}
          >
            {otherGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            className={styles.importBtn}
            onClick={handleImport}
            disabled={importing || !importSourceId}
          >
            {importing ? "Importando..." : "Importar"}
          </button>
          {importFeedback && (
            <span
              className={
                importFeedback.ok ? styles.importSuccess : styles.importError
              }
            >
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
        onSelect={(round) => {
          trackEvent("change_predictions_rodada", { round });
          setRoundIndex(roundKeys.indexOf(round));
        }}
      />

      <div className={styles.saveAllBar}>
        {bulkError && <span className={styles.error}>{bulkError}</span>}
        <button
          className={`${styles.saveAllBtn} ${savedAll ? styles.saveAllBtnSaved : ""}`}
          onClick={handleSaveAll}
          disabled={pendingCount === 0 || savingAll}
        >
          {savingAll
            ? "Salvando..."
            : savedAll
              ? "Tudo salvo!"
              : pendingCount > 0
                ? `Salvar todos (${pendingCount})`
                : "Salvar todos"}
        </button>
      </div>

      {groupedRoundMatches(roundMatches).map(([groupName, groupMatches]) => (
        <div key={groupName ?? "__no_group"} className={styles.matchGroup}>
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
  );
}
