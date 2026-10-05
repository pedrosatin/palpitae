import { useState } from 'react'
import { trackShareInvite } from '../../analytics/funnel'
import { trackEvent } from '../../analytics/ga'
import Button from '../../components/Button'
import ShareButtons from '../../components/ShareButtons'
import { buildInviteLink, buildInviteMessage } from '../../lib/invite'
import styles from './GroupDetailPage.module.css'
import shared from '../../components/modal-shared.module.css'

interface GroupInviteSectionProps {
  inviteCode: string
  /** Nome do grupo, usado na mensagem que acompanha o link. */
  groupName?: string
}

function GroupInviteSection({ inviteCode, groupName }: GroupInviteSectionProps) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  function getShareLink() {
    return buildInviteLink(inviteCode)
  }

  async function copyCode() {
    await navigator.clipboard.writeText(inviteCode)
    trackEvent('click_group_detail_copiar_codigo')
    trackShareInvite('copy_code', 'group_detail')
    setCopied('code')
    setTimeout(() => setCopied(null), 2000)
  }

  async function copyLink() {
    await navigator.clipboard.writeText(getShareLink())
    trackEvent('click_group_detail_copiar_link')
    trackShareInvite('copy_link', 'group_detail')
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
            <Button variant="outline" size="sm" onClick={copyCode}>
              {copied === 'code' ? 'Copiado!' : 'Copiar'}
            </Button>
          </div>
        </div>
        <div className={styles.linkBox}>
          <span className={styles.codeLabel}>Link direto</span>
          <div className={styles.linkValueRow}>
            <span className={shared.linkText}>{getShareLink()}</span>
            <Button variant="outline" size="sm" onClick={copyLink}>
              {copied === 'link' ? 'Copiado!' : 'Copiar link'}
            </Button>
          </div>
        </div>
      </div>
      <ShareButtons
        shareLink={getShareLink()}
        eventContext="group_detail"
        message={buildInviteMessage(groupName)}
      />
    </div>
  )
}

export default GroupInviteSection
