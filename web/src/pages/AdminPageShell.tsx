import type { ReactNode } from 'react'
import { trackEvent } from '../analytics/ga'
import ErrorState from '../components/ErrorState'
import AdminPills from './AdminPills'
import shared from './admin-shared.module.css'

const PERIODS = [7, 30, 90] as const
const PERIOD_OPTIONS = PERIODS.map((p) => ({ value: p, label: `${p}d` }))

type AdminPageShellProps = {
  title: string
  days: number
  onDaysChange: (days: number) => void
  periodEventName: string
  forbidden: boolean
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
          <AdminPills
            options={PERIOD_OPTIONS}
            value={days}
            ariaLabel="Período"
            onChange={(p) => {
              trackEvent(periodEventName, { days: p })
              onDaysChange(p)
            }}
          />
        </div>

        {children}
      </div>
    </div>
  )
}

/** Falha de carga dos painéis admin, com "Tentar novamente" para o período selecionado. */
export function AdminLoadError({
  message,
  retryEventName,
  onRetry,
}: {
  message: string
  retryEventName: string
  onRetry: () => void
}) {
  return (
    <ErrorState>
      {message}
      <button
        type="button"
        className={shared.retryButton}
        onClick={() => {
          trackEvent(retryEventName)
          onRetry()
        }}
      >
        Tentar novamente
      </button>
    </ErrorState>
  )
}
