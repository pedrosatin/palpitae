import { useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import Button from '../../components/Button'
import ShareButtons from '../../components/ShareButtons'
import { buildGroupLink, buildGroupLinkMessage } from '../../lib/groupLink'
import styles from './GroupDetailPage.module.css'
import shared from '../../components/modal-shared.module.css'

interface GroupLinkSectionProps {
  publicId: string
  groupName?: string
}

/**
 * Link do grupo para qualquer membro. Não carrega o código de convite: quem
 * abre pede entrada e o dono aprova na aba Membros.
 */
export default function GroupLinkSection({ publicId, groupName }: GroupLinkSectionProps) {
  const [copied, setCopied] = useState(false)
  const link = buildGroupLink(publicId)

  async function copyLink() {
    await navigator.clipboard.writeText(link)
    trackEvent('click_group_detail_copiar_link_pedido')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className={styles.inviteSection} data-testid="group-link-section">
      <h2 className={styles.inviteTitle}>
        <span className={styles.inviteTitleText}>Link do grupo</span>
      </h2>
      <div className={styles.inviteBody} data-expanded>
        <p className={styles.inviteAloneNote}>
          Qualquer membro pode compartilhar. Quem abrir pede para entrar; o dono aprova.
        </p>
        <div className={styles.linkBox}>
          <span className={styles.codeLabel}>Link para pedir entrada</span>
          <div className={styles.linkValueRow}>
            <span className={shared.linkText}>{link}</span>
            <Button variant="outline" size="sm" onClick={copyLink}>
              {copied ? 'Copiado!' : 'Copiar link'}
            </Button>
          </div>
        </div>
        <ShareButtons
          shareLink={link}
          eventContext="group_link"
          message={buildGroupLinkMessage(groupName)}
        />
      </div>
    </section>
  )
}
