import type { ReactNode } from 'react'
import { trackEvent } from '../analytics/ga'
import ErrorState from '../components/ErrorState'
import shared from './admin-shared.module.css'

const PERIODS = [7, 30, 90] as const

type AdminPageShellProps = {
  /** Heading shown in the title row. */
  title: string
  /** Currently selected window, in days. */
  days: number
  onDaysChange: (days: number) => void
  /** GA event fired when a period pill is clicked (e.g. `click_admin_metrics_periodo`). */
  periodEventName: string
  /** When true, render only the "restricted" message instead of the dashboard. */
  forbidden: boolean
  /** The page's own `.content` class — the two admin pages differ only in max-width. */
  contentClassName: string
  children: ReactNode
}

/**
 * Shared frame for the admin dashboards (metrics, radar): page shell, the
 * forbidden guard and the period pill selector. Everything below the title
 * row is passed as children.
 */
export default function AdminPageShell({
  title,
  days,
  onDaysChange,
  periodEventName,
  forbidden,
  contentClassName,
  children,
}: AdminPageShellProps) {
  if (forbidden) {
    return (
      <div className={shared.root}>
        <div className={contentClassName}>
          <ErrorState message="Acesso restrito ao administrador." />
        </div>
      </div>
    )
  }

  return (
    <div className={shared.root}>
      <div className={contentClassName}>
        <div className={shared.titleRow}>
          <h1 className={shared.title}>{title}</h1>
          <div className={shared.periods}>
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                className={p === days ? shared.periodActive : shared.period}
                onClick={() => {
                  trackEvent(periodEventName, { days: p })
                  onDaysChange(p)
                }}
              >
                {p}d
              </button>
            ))}
          </div>
        </div>

        {children}
      </div>
    </div>
  )
}
