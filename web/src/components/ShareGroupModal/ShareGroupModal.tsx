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
  URL.revokeObjectURL(url)
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

    const file = new File([blob], fileName(data), { type: 'image/png' })
    const payload = { files: [file], text: `${shareText(data)} ${data.domain}` }

    if (navigator.canShare?.(payload)) {
      try {
        await navigator.share(payload)
        trackEvent('click_share_compartilhar', { method: 'native' })
      } catch {
        // Usuário cancelou o share sheet — sem erro.
      }
      return
    }

    // Sem Web Share de arquivos (desktop) → baixa a imagem.
    download(blob, fileName(data))
    trackEvent('click_share_compartilhar', { method: 'download' })
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
        <Button variant="primary" onClick={handleShare} disabled={!previewUrl}>
          Compartilhar
        </Button>
        <Button variant="outline" onClick={handleDownload} disabled={!previewUrl}>
          Baixar imagem
        </Button>
        <Button variant="ghost" onClick={handleCopyLink}>
          {copied ? 'Link copiado ✓' : 'Copiar link'}
        </Button>
      </div>
    </Modal>
  )
}
