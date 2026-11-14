import type { ReactNode } from 'react'
import shared from './admin-shared.module.css'

export interface AdminPillOption<T extends string | number> {
  value: T
  label: ReactNode
  disabled?: boolean
}

interface AdminPillsProps<T extends string | number> {
  options: readonly AdminPillOption<T>[]
  value: T | null
  onChange: (value: T) => void
  className?: string
  /** Atributos opcionais até a padronização de acessibilidade no ticket 25. */
  role?: 'group'
  ariaLabel?: string
  ariaPressed?: boolean
}

/** Grupo de botões em pílula compartilhado pelos painéis admin. */
export default function AdminPills<T extends string | number>({
  options,
  value,
  onChange,
  className = shared.periods,
  role,
  ariaLabel,
  ariaPressed = false,
}: AdminPillsProps<T>) {
  return (
    <div className={className} role={role} aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            aria-pressed={ariaPressed ? active : undefined}
            className={active ? shared.periodActive : shared.period}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
