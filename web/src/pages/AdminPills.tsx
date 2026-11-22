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
  ariaLabel?: string
}

/**
 * Grupo de botões em pílula compartilhado pelos painéis admin. Cada botão
 * anuncia com `aria-pressed` se é a opção ativa.
 */
export default function AdminPills<T extends string | number>({
  options,
  value,
  onChange,
  className = shared.periods,
  ariaLabel,
}: AdminPillsProps<T>) {
  return (
    <div className={className} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            aria-pressed={active}
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
