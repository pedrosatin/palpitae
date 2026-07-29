import { useEffect, useState } from "react";
import { config } from "../../config";
import { trackEvent } from "../../analytics/ga";
import { apiFetch } from "../../lib/api";
import {
  type Match,
  type Prediction,
  OUTCOMES,
  type Outcome,
} from "./MatchCard";

export interface UseMatchCardProps {
  match: Match;
  prediction: Prediction | undefined;
  groupId: string;
  outcomeOnly?: boolean;
  onSaved: (
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: "home" | "away" | null,
  ) => void;
  onDraftChange?: (matchId: string, home: string, away: string) => void;
  onPenaltyDraftChange?: (
    matchId: string,
    winner: "home" | "away" | null,
  ) => void;
}

export function useMatchCard({
  match,
  prediction,
  groupId,
  outcomeOnly = false,
  onSaved,
  onDraftChange,
  onPenaltyDraftChange,
}: UseMatchCardProps) {
  const locked =
    Boolean(prediction?.locked) || new Date() >= new Date(match.start_time);

  const [home, setHome] = useState<string>(
    prediction !== undefined ? String(prediction.predicted_home_score) : "0",
  );
  const [away, setAway] = useState<string>(
    prediction !== undefined ? String(prediction.predicted_away_score) : "0",
  );
  const [penaltyWinner, setPenaltyWinner] = useState<"home" | "away" | null>(
    prediction?.predicted_penalty_winner ?? null,
  );

  useEffect(() => {
    if (prediction !== undefined) {
      setHome(String(prediction.predicted_home_score));
      setAway(String(prediction.predicted_away_score));
      setPenaltyWinner(prediction.predicted_penalty_winner ?? null);
    }
  }, [prediction]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pendingOutcome, setPendingOutcome] = useState<
    "home" | "draw" | "away" | null
  >(null);
  const [reopenPenalty, setReopenPenalty] = useState(false);

  const isFinished = match.status === "finished";
  const hasPrediction = prediction !== undefined;

  const selectedOutcome: Outcome | null = hasPrediction
    ? prediction.predicted_home_score > prediction.predicted_away_score
      ? "home"
      : prediction.predicted_home_score < prediction.predicted_away_score
        ? "away"
        : "draw"
    : pendingOutcome;

  const drawMarked = outcomeOnly
    ? selectedOutcome === "draw"
    : home !== "" && away !== "" && Number(home) === Number(away);
  const showPenaltyPicker =
    !locked && Boolean(match.decides_on_penalties) && drawMarked;

  const scoreChanged = hasPrediction
    ? Number(home) !== prediction.predicted_home_score ||
      Number(away) !== prediction.predicted_away_score
    : true;
  const penaltyChanged =
    (penaltyWinner ?? null) !== (prediction?.predicted_penalty_winner ?? null);
  const hasChanged = scoreChanged || penaltyChanged;
  const penaltyReady = !showPenaltyPicker || penaltyWinner !== null;
  const canSave =
    !locked &&
    home !== "" &&
    away !== "" &&
    !saving &&
    hasChanged &&
    penaltyReady;

  async function persist(
    homeScore: number,
    awayScore: number,
    penWinner: "home" | "away" | null,
  ) {
    setSaving(true);
    setError(null);
    setSaved(false);

    const res = await apiFetch(`${config.apiUrl}/predictions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        group_id: groupId,
        match_id: match.id,
        predicted_home_score: homeScore,
        predicted_away_score: awayScore,
        predicted_penalty_winner: penWinner,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Erro ao salvar palpite");
      return;
    }

    setSaved(true);
    onSaved(match.id, homeScore, awayScore, penWinner);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleSave() {
    if (!canSave) return;
    trackEvent("click_matchcard_salvar", { match_id: match.id });
    await persist(
      Number(home),
      Number(away),
      showPenaltyPicker ? penaltyWinner : null,
    );
  }

  async function selectOutcome(outcome: Outcome) {
    if (locked || saving) return;
    if (outcome === selectedOutcome) return;
    trackEvent("click_matchcard_resultado", { match_id: match.id, outcome });
    const { home: h, away: a } = OUTCOMES[outcome];
    setHome(String(h));
    setAway(String(a));
    setPendingOutcome(outcome);
    onDraftChange?.(match.id, String(h), String(a));

    if (outcome === "draw" && match.decides_on_penalties) {
      return;
    }
    if (penaltyWinner !== null) {
      setPenaltyWinner(null);
      onPenaltyDraftChange?.(match.id, null);
    }
    await persist(h, a, null);
  }

  async function selectPenaltyWinner(winner: "home" | "away") {
    if (locked || saving) return;
    trackEvent("click_prediction_penalty_winner", {
      match_id: match.id,
      winner,
    });
    setPenaltyWinner(winner);
    setReopenPenalty(false);
    onPenaltyDraftChange?.(match.id, winner);
    if (outcomeOnly) {
      await persist(0, 0, winner);
    }
  }

  function clearPenaltyIfLeavingDraw(nextHome: string, nextAway: string) {
    const stillDraw =
      nextHome !== "" &&
      nextAway !== "" &&
      Number(nextHome) === Number(nextAway);
    if (!stillDraw && penaltyWinner !== null) {
      setPenaltyWinner(null);
      setReopenPenalty(false);
      onPenaltyDraftChange?.(match.id, null);
    }
  }

  function updateHome(v: string) {
    setHome(v);
    onDraftChange?.(match.id, v, away);
    clearPenaltyIfLeavingDraw(v, away);
  }

  function updateAway(v: string) {
    setAway(v);
    onDraftChange?.(match.id, home, v);
    clearPenaltyIfLeavingDraw(home, v);
  }

  function handleScoreInput(value: string, update: (v: string) => void) {
    if (value === "" || /^\d{1,2}$/.test(value)) update(value);
  }

  return {
    locked,
    isFinished,
    hasPrediction,
    saving,
    saved,
    error,
    canSave,
    home,
    away,
    penaltyWinner,
    reopenPenalty,
    selectedOutcome,
    showPenaltyPicker,
    setReopenPenalty,
    handleSave,
    selectOutcome,
    selectPenaltyWinner,
    updateHome,
    updateAway,
    handleScoreInput,
  };
}
