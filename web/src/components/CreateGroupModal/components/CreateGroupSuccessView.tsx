import { useState } from 'react'
import { trackShareInvite } from '../../../analytics/funnel'
import { trackEvent } from '../../../analytics/ga'
import { buildInviteLink, buildInviteMessage } from '../../../lib/invite'
import Button from '../../Button'
import ShareButtons from '../../ShareButtons'
import styles from '../CreateGroupModal.module.css'
import shared from '../../modal-shared.module.css'

interface CreatedGroup {
  id: string
  name: string
  invite_code: string
}

interface CreateGroupSuccessViewProps {
  created: CreatedGroup
  onClose: () => void
}

export default function CreateGroupSuccessView({ created, onClose }: CreateGroupSuccessViewProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopyCode(invite_code: string) {
    await navigator.clipboard.writeText(invite_code)
    trackEvent('click_create_group_copiar_codigo')
    trackShareInvite('copy_code', 'create_group')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleCopyLink(invite_code: string) {
    await navigator.clipboard.writeText(buildInviteLink(invite_code))
    trackEvent('click_create_group_copiar_link')
    trackShareInvite('copy_link', 'create_group')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={shared.success}>
      <div className={shared.successIcon}>🎉</div>
      <h3 className={shared.successTitle}>Grupo criado!</h3>
      <p className={shared.successName}>{created.name}</p>
      <p className={styles.inviteLabel}>Compartilhe o código com seus amigos:</p>

      <div className={styles.codeBox}>
        <span className={styles.code}>{created.invite_code}</span>
        <Button variant="outline" size="sm" onClick={() => handleCopyCode(created.invite_code)}>
          {copied ? 'Copiado!' : 'Copiar'}
        </Button>
      </div>

      <div className={styles.linkRow}>
        <span className={shared.linkText}>{buildInviteLink(created.invite_code)}</span>
        <Button variant="outline" size="sm" onClick={() => handleCopyLink(created.invite_code)}>
          {copied ? 'Copiado!' : 'Copiar link'}
        </Button>
      </div>

      <ShareButtons
        shareLink={buildInviteLink(created.invite_code)}
        eventContext="create_group"
        message={buildInviteMessage(created.name)}
      />

      <Button variant="primary" className={styles.doneBtn} onClick={onClose}>
        Pronto
      </Button>
    </div>
  )
}
