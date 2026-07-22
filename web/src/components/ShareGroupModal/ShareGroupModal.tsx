import { useEffect, useRef, useState } from 'react'
import Modal from '../Modal'
import Button from '../Button'
import { trackEvent } from '../../analytics/ga'
import { buildShareCardData, renderShareCardBlob, type ShareCardData } from '../../lib/shareCard'
import type { GroupWithStats } from '../GroupCard'
import styles from './ShareGroupModal.module.css'

interface ShareGroupModalProps {
  isOpen: boolean
  onClose: () => void
  group: GroupWithStats
}

function shareText(data: ShareCardData): string {
  return data.isChampion
    ? `Fui campeão do bolão "${data.competition}" no Palpitae! 🏆`
    : `Fiquei em ${data.position}º de ${data.total} no bolão "${data.competition}" no Palpitae!`
}

function fileName(data: ShareCardData): string {
  const slug = data.isChampion ? 'campeao' : `${data.position}-lugar`
  return `palpitae-${slug}.png`
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Revoga no próximo tick — revogar antes de o navegador iniciar o download
  // interrompe o salvamento em alguns browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * O navegador consegue compartilhar um arquivo de imagem via share sheet nativo?
 * Verdadeiro no mobile (iOS/Android), falso no desktop — onde "compartilhar"
 * seria só um download disfarçado. Sondamos com um File vazio para não duplicar
 * o botão de baixar quando não há share real.
 */
function canShareImageFiles(): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false
  try {
    return navigator.canShare({ files: [new File([], 'r.png', { type: 'image/png' })] })
  } catch {
    return false
  }
}

/**
 * Preview do cartão de resultado antes de postar. Renderiza o PNG no cliente e
 * oferece três saídas: compartilhar (share sheet nativo no mobile → WhatsApp,
 * Stories...), baixar a imagem, ou copiar o link do Palpitae. O link aponta pra
 * landing — o objetivo é divulgar e atrair gente nova, não convidar pro grupo
 * (que já encerrou).
 */
export default function ShareGroupModal({ isOpen, onClose, group }: ShareGroupModalProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [canShareFiles] = useState(canShareImageFiles)
  const blobRef = useRef<Blob | null>(null)
  const dataRef = useRef<ShareCardData | null>(null)

  useEffect(() => {
    if (!isOpen) return
    let objectUrl: string | null = null
    let cancelled = false

    const data = buildShareCardData(group, window.location.origin)
    dataRef.current = data

    renderShareCardBlob(data).then((blob) => {
      if (cancelled) return
      blobRef.current = blob
      if (blob) {
        objectUrl = URL.createObjectURL(blob)
        setPreviewUrl(objectUrl)
      }
    })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setPreviewUrl(null)
      setCopied(false)
    }
  }, [isOpen, group])

  async function handleShare() {
    const blob = blobRef.current
    const data = dataRef.current
    if (!blob || !data) return

    // Só renderizado quando `canShareFiles` — share sheet nativo com a imagem.
    const file = new File([blob], fileName(data), { type: 'image/png' })
    try {
      await navigator.share({ files: [file], text: `${shareText(data)} ${data.domain}` })
      trackEvent('click_share_compartilhar')
    } catch {
      // Usuário cancelou o share sheet — sem erro.
    }
  }

  function handleDownload() {
    const blob = blobRef.current
    const data = dataRef.current
    if (!blob || !data) return
    download(blob, fileName(data))
    trackEvent('click_share_baixar')
  }

  async function handleCopyLink() {
    await navigator.clipboard.writeText(window.location.origin)
    setCopied(true)
    trackEvent('click_share_copiar_link')
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Compartilhar resultado">
      <div className={styles.preview}>
        {previewUrl ? (
          <img
            className={styles.image}
            src={previewUrl}
            alt="Prévia do cartão de resultado do bolão"
          />
        ) : (
          <div className={styles.placeholder} role="status">
            Gerando imagem…
          </div>
        )}
      </div>

      <div className={styles.actions}>
        {canShareFiles && (
          <Button variant="primary" onClick={handleShare} disabled={!previewUrl}>
            Compartilhar
          </Button>
        )}
        <Button
          variant={canShareFiles ? 'outline' : 'primary'}
          onClick={handleDownload}
          disabled={!previewUrl}
        >
          Baixar imagem
        </Button>
        <Button variant="ghost" onClick={handleCopyLink}>
          {copied ? 'Link copiado ✓' : 'Copiar link'}
        </Button>
      </div>
    </Modal>
  )
}
