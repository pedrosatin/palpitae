import { useId } from 'react'
import { Link } from 'react-router-dom'
import { trackEvent } from '../../analytics/ga'
import {
  allPredictedWord,
  formatLongWhen,
  pendingCountText,
  type DeadlineBanner,
} from '../../lib/dashboardStatus'
import styles from './NextDeadlineBanner.module.css'

/** Link para a aba Palpitar do grupo, aberta na rodada do jogo quando há um. */
function predictionsHref(groupId: string, round: string | null): string {
  const base = `/grupos/${groupId}`
  return round ? `${base}?rodada=${encodeURIComponent(round)}` : base
}

/**
 * Faixa do topo do painel. Com jogo sem palpite, mostra o que fecha primeiro e
 * leva ao grupo mais urgente. Sem pendência, diz que a rodada está toda palpitada.
 */
export default function NextDeadlineBanner({
  banner,
  nowMs,
}: {
  banner: DeadlineBanner
  nowMs: number
}) {
  const labelId = useId()

  if (banner.kind === 'clear') {
    return (
      <section className={styles.banner} data-kind="clear" aria-label="Próximo prazo">
        <p className={styles.clear}>
          <span className={styles.check} aria-hidden="true">
            ✓
          </span>
          {banner.roundLabel} {allPredictedWord(banner.roundLabel)}
        </p>
      </section>
    )
  }

  const { match } = banner
  const pendingText = pendingCountText(banner.totalPending, banner.groupsWithPending)

  return (
    <section className={styles.banner} data-kind="pending" aria-labelledby={labelId}>
      <div className={styles.text}>
        <h2 id={labelId} className={styles.label}>
          Próximo prazo
        </h2>
        {match && (
          <p className={styles.match}>
            {match.home_team} × {match.away_team} fecha {formatLongWhen(match.start_time, nowMs)}
          </p>
        )}
        <p className={styles.meta}>
          {match ? `${match.round_label} · ${pendingText}` : pendingText}
        </p>
      </div>
      <Link
        className={styles.action}
        to={predictionsHref(banner.groupId, match?.round ?? null)}
        onClick={() => trackEvent('click_dashboard_proximo_prazo', { group_id: banner.groupId })}
      >
        Palpitar em {banner.groupName}
      </Link>
    </section>
  )
}
