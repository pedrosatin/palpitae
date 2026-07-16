import { useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import styles from './GroupDetailPage.module.css'

interface GroupInviteSectionProps {
  inviteCode: string
}

export function GroupInviteSection({ inviteCode }: GroupInviteSectionProps) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  function getShareLink() {
    return `${window.location.origin}?convite=${inviteCode}`
  }

  async function copyCode() {
    await navigator.clipboard.writeText(inviteCode)
    trackEvent('click_group_detail_copiar_codigo')
    setCopied('code')
    setTimeout(() => setCopied(null), 2000)
  }

  async function copyLink() {
    await navigator.clipboard.writeText(getShareLink())
    trackEvent('click_group_detail_copiar_link')
    setCopied('link')
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className={styles.inviteSection}>
      <h2 className={styles.inviteTitle}>Convidar membros</h2>
      <div className={styles.inviteRow}>
        <div className={styles.codeBox}>
          <span className={styles.codeLabel}>Código</span>
          <div className={styles.codeValueRow}>
            <span className={styles.code}>{inviteCode}</span>
            <button className={styles.copyBtn} onClick={copyCode}>
              {copied === 'code' ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>
        <div className={styles.linkBox}>
          <span className={styles.codeLabel}>Link direto</span>
          <div className={styles.linkValueRow}>
            <span className={styles.linkText}>{getShareLink()}</span>
            <button className={styles.copyBtn} onClick={copyLink}>
              {copied === 'link' ? 'Copiado!' : 'Copiar link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GroupInviteSection
