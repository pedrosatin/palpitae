import styles from './MatchCard.module.css'

export function ScoreStepper({
  teamName,
  score,
  locked,
  matchId,
  prefix,
  updateScore,
  handleScoreInput,
}: {
  teamName: string
  score: string
  locked: boolean
  matchId: string
  prefix: 'home' | 'away'
  updateScore: (v: string) => void
  handleScoreInput: (value: string, update: (v: string) => void) => void
}) {
  return (
    <div className={styles.stepper}>
      <button
        className={`${styles.stepBtn} ${styles.stepBtnDec}`}
        onClick={() => updateScore(String(Math.max(0, (score === '' ? 0 : Number(score)) - 1)))}
        disabled={locked}
        type="button"
        tabIndex={-1}
        aria-label={`Diminuir placar ${teamName}`}
      >
        −
      </button>
      <input
        className={styles.scoreInput}
        type="number"
        id={`${prefix}-score-${matchId}`}
        name={`${prefix}-score-${matchId}`}
        min={0}
        max={99}
        placeholder="0"
        value={score}
        onChange={(e) => handleScoreInput(e.target.value, updateScore)}
        aria-label={`Placar ${teamName}`}
      />
      <button
        className={`${styles.stepBtn} ${styles.stepBtnInc}`}
        onClick={() => updateScore(String(Math.min(99, (score === '' ? 0 : Number(score)) + 1)))}
        disabled={locked}
        type="button"
        tabIndex={-1}
        aria-label={`Aumentar placar ${teamName}`}
      >
        +
      </button>
    </div>
  )
}
