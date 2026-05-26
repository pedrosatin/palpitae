import type { ReactNode } from 'react'
import styles from './Card.module.css'

interface CardProps {
  children: ReactNode
  hoverable?: boolean
  className?: string
}

export default function Card({
  children,
  hoverable = false,
  className,
}: CardProps) {
  const classes = [
    styles.card,
    hoverable ? styles.hoverable : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return <div className={classes}>{children}</div>
}
