import type { RoundTally } from '../../lib/roundSummary'
import styles from './RoundSummary.module.css'

interface RoundSummaryStatsProps {
  own: RoundTally
  pointsExact: number
}

/** Números do próprio usuário no resumo: pontos, exatos, acertos e jogos sem palpite. */
export function RoundSummaryStats({ own, pointsExact }: RoundSummaryStatsProps) {
  return (
    <>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.value}>{own.points}</span>
          <span className={styles.label}>{own.points === 1 ? 'ponto' : 'pontos'}</span>
        </div>
        {pointsExact > 0 && (
          <div className={styles.stat}>
            <span className={styles.value}>{own.exact}</span>
            <span className={styles.label}>
              {own.exact === 1 ? 'placar exato' : 'placares exatos'}
            </span>
          </div>
        )}
        <div className={styles.stat}>
          <span className={styles.value}>{own.correct}</span>
          <span className={styles.label}>
            {own.correct === 1 ? 'resultado certo' : 'resultados certos'}
          </span>
        </div>
      </div>
      {own.missed > 0 && (
        <p className={styles.line}>
          {own.missed === 1 ? '1 jogo ficou' : `${own.missed} jogos ficaram`} sem palpite.
        </p>
      )}
    </>
  )
}
