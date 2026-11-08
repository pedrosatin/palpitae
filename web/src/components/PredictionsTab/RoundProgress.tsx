import { useNow } from '../../hooks/useNow'
import { closingText } from '../../lib/matchTime'
import { progressLabel, roundProgress } from '../../lib/roundProgress'
import CheckIcon from '../CheckIcon'
import type { Match, Prediction } from '../MatchCard'
import styles from './PredictionsTab.module.css'

/** Intervalo do relógio do "fecha em ...". A contagem mostra minutos. */
const TICK_MS = 30_000

interface RoundProgressProps {
  roundMatches: Match[]
  predictions: Map<string, Prediction>
}

/**
 * Linha abaixo do seletor de rodada com quantos jogos já têm palpite e quando fecha
 * o próximo. O contador é região `status`: salvar um palpite muda o texto, e o
 * leitor de tela anuncia o novo total. A linha some quando a rodada não tem jogo
 * aberto.
 */
export default function RoundProgress({ roundMatches, predictions }: RoundProgressProps) {
  const now = useNow(TICK_MS)
  const progress = roundProgress(roundMatches, predictions, now)
  if (!progress) return null
  const complete = progress.predicted === progress.total

  return (
    <div className={styles.roundProgress}>
      <span role="status" className={complete ? styles.progressDone : styles.progressPending}>
        {complete && <CheckIcon />}
        {progressLabel(progress)}
      </span>
      {progress.nextClosing && (
        <span className={styles.progressClosing}>
          próximo jogo fecha {closingText(progress.nextClosing, now)}
        </span>
      )}
    </div>
  )
}
