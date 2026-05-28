import styles from './TeamBadge.module.css'

interface TeamBadgeProps {
  short: string
  logo: string | null
}

export default function TeamBadge({ short, logo }: TeamBadgeProps) {
  return (
    <span className={styles.teamBadge}>
      {logo ? (
        <img src={logo} alt={short} className={styles.teamLogo} />
      ) : (
        <span className={styles.teamLogoPlaceholder} />
      )}
      <span className={styles.teamShort}>{short}</span>
    </span>
  )
}
