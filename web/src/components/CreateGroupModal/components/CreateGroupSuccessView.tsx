import { useState } from 'react'
import { trackEvent } from '../../../analytics/ga'
import Button from '../../Button'
import styles from '../CreateGroupModal.module.css'

interface CreatedGroup {
  id: string
  name: string
  invite_code: string
}

interface CreateGroupSuccessViewProps {
  created: CreatedGroup
  onClose: () => void
}

export default function CreateGroupSuccessView({
  created,
  onClose,
}: CreateGroupSuccessViewProps) {
  const [copied, setCopied] = useState(false)

  function getShareLink(invite_code: string) {
    return `${window.location.origin}?convite=${invite_code}`
  }

  async function handleCopyCode(invite_code: string) {
    await navigator.clipboard.writeText(invite_code)
    trackEvent('click_create_group_copiar_codigo')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleCopyLink(invite_code: string) {
    await navigator.clipboard.writeText(getShareLink(invite_code))
    trackEvent('click_create_group_copiar_link')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={styles.success}>
      <div className={styles.successIcon}>🎉</div>
      <h3 className={styles.successTitle}>Grupo criado!</h3>
      <p className={styles.successName}>{created.name}</p>
      <p className={styles.inviteLabel}>
        Compartilhe o código com seus amigos:
      </p>

      <div className={styles.codeBox}>
        <span className={styles.code}>{created.invite_code}</span>
        <button
          className={styles.copyBtn}
          onClick={() => handleCopyCode(created.invite_code)}
        >
          {copied ? 'Copiado!' : 'Copiar'}
        </button>
      </div>

      <div className={styles.linkRow}>
        <span className={styles.linkText}>
          {getShareLink(created.invite_code)}
        </span>
        <button
          className={styles.copyBtn}
          onClick={() => handleCopyLink(created.invite_code)}
        >
          {copied ? 'Copiado!' : 'Copiar link'}
        </button>
      </div>

      <Button
        variant="primary"
        className={styles.doneBtn}
        onClick={onClose}
      >
        Pronto
      </Button>
    </div>
  )
}
