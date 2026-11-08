import { useId, useState } from 'react'
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
  /** Troca o código de convite. Sem ele, o botão não aparece. */
  onRotate?: () => void
  /** Troca em andamento. */
  rotating?: boolean
}

function GroupInviteSection({
  inviteCode,
  groupName,
  onRotate,
  rotating,
}: GroupInviteSectionProps) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  // Só vale no celular, onde o CSS começa com o convite recolhido.
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()

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

  function toggleExpanded() {
    trackEvent('click_group_detail_abrir_convite', { open: !expanded })
    setExpanded((value) => !value)
  }

  // O texto do título e o botão ficam no mesmo h2, e o CSS mostra um dos dois.
  // Acima de 600 px aparece o título e o conteúdo fica aberto. No celular
  // aparece o botão, e o conteúdo só abre com `data-expanded`. O h2 continua na
  // navegação por títulos nos dois casos. Sem matchMedia, o primeiro render já
  // sai no estado certo.
  return (
    <section className={styles.inviteSection} data-expanded={expanded || undefined}>
      <h2 className={styles.inviteTitle}>
        <span className={styles.inviteTitleText}>Convidar membros</span>
        <button
          type="button"
          className={styles.inviteToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={toggleExpanded}
        >
          <span>Convidar membros</span>
          <span className={styles.inviteToggleHint}>código e link</span>
          <span className={styles.inviteChevron} aria-hidden="true">
            ▾
          </span>
        </button>
      </h2>
      <div id={bodyId} className={styles.inviteBody}>
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
        {onRotate && (
          <div className={styles.inviteRotateRow}>
            <span className={styles.inviteRotateHint}>
              Se o código vazou, gere outro. O atual deixa de funcionar.
            </span>
            <Button variant="ghost" size="sm" onClick={onRotate} disabled={rotating}>
              {rotating ? 'Trocando...' : 'Trocar código'}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

export default GroupInviteSection
