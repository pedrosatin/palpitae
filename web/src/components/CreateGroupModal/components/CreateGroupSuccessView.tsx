import { useState } from 'react'
import { trackShareInvite, type ShareInviteMethod } from '../../../analytics/funnel'
import { trackEvent } from '../../../analytics/ga'
import { buildInviteLink, buildInviteMessage } from '../../../lib/invite'
import Button from '../../Button'
import ShareButtons, { WhatsAppShareButton } from '../../ShareButtons'
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
  const inviteLink = buildInviteLink(created.invite_code)

  async function copy(text: string, event: string, method: ShareInviteMethod) {
    await navigator.clipboard.writeText(text)
    trackEvent(event)
    trackShareInvite(method, 'create_group')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleDone() {
    trackEvent('click_create_group_pronto')
    onClose()
  }

  return (
    <div className={shared.success}>
      <div className={shared.successIcon}>🎉</div>
      <h3 className={shared.successTitle}>Grupo criado!</h3>
      <p className={shared.successName}>{created.name}</p>

      <WhatsAppShareButton
        label="Chamar a galera no WhatsApp"
        eventContext="create_group"
        shareLink={inviteLink}
        message={buildInviteMessage(created.name)}
        prominent
        onShared={(method) => trackShareInvite(method, 'create_group')}
      />

      <p className={styles.inviteLabel}>Ou compartilhe o código com seus amigos:</p>

      <div className={styles.codeBox}>
        <span className={styles.code}>{created.invite_code}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => copy(created.invite_code, 'click_create_group_copiar_codigo', 'copy_code')}
        >
          {copied ? 'Copiado!' : 'Copiar'}
        </Button>
      </div>

      <div className={styles.linkRow}>
        <span className={shared.linkText}>{inviteLink}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => copy(inviteLink, 'click_create_group_copiar_link', 'copy_link')}
        >
          {copied ? 'Copiado!' : 'Copiar link'}
        </Button>
      </div>

      <ShareButtons
        shareLink={inviteLink}
        eventContext="create_group"
        message={buildInviteMessage(created.name)}
        secondary
      />

      <Button variant="secondary" className={styles.doneBtn} onClick={handleDone}>
        Pronto
      </Button>
    </div>
  )
}
