import styles from './MemberBadge.module.css'

interface MemberBadgeProps {
  variant: 'owner' | 'self'
  className?: string
}

const LABELS = { owner: 'admin', self: 'você' } as const

/** Selo "admin" ou "você" ao lado do nome de um membro. */
export default function MemberBadge({ variant, className }: MemberBadgeProps) {
  const classes = className ? `${styles[variant]} ${className}` : styles[variant]
  return <span className={classes}>{LABELS[variant]}</span>
}
