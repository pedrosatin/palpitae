import { useState } from 'react'
import { trackShareInvite } from '../../analytics/funnel'
import { trackEvent } from '../../analytics/ga'
import type { ExactMilestone } from '../../lib/exactMilestones'
import {
  buildMilestoneShareCardData,
  milestoneShareFileName,
  milestoneShareText,
  renderMilestoneShareCardBlob,
} from '../../lib/milestoneShareCard'
import type { RoundStanding, RoundTally } from '../../lib/roundSummary'
import {
  buildRoundShareCardData,
  renderRoundShareCardBlob,
  roundShareFileName,
  roundShareText,
} from '../../lib/roundShareCard'
import { shareOrDownloadImage } from '../../lib/shareImage'
import Button from '../Button'
import styles from './RoundSummary.module.css'

interface RoundShareActionsProps {
  groupName?: string
  roundLabel: string
  postponed: number
  own: RoundTally
  standings: RoundStanding[] | null
  self: RoundStanding | undefined
  crossed: ExactMilestone[]
  exactHits: number
  shareLink: string | null
}

type DownloadNotice =
  | { kind: 'copied' }
  | { kind: 'downloaded' }
  | { kind: 'manual'; link: string }
  | null

async function shareRoundImage(input: {
  groupName?: string
  roundLabel: string
  postponed: number
  own: RoundTally
  standings: RoundStanding[]
  self: RoundStanding
}): Promise<boolean> {
  trackEvent('click_resumo_rodada_compartilhar')
  try {
    const data = buildRoundShareCardData({
      groupName: input.groupName ?? 'Palpitae',
      roundLabel: input.roundLabel,
      standings: input.standings,
      self: { ...input.own, position: input.self.position },
      postponed: input.postponed,
      origin: window.location.origin,
    })
    const blob = await renderRoundShareCardBlob(data)
    if (!blob) return false
    await shareOrDownloadImage(
      blob,
      roundShareFileName(input.roundLabel),
      roundShareText(data),
    )
    return true
  } catch {
    return false
  }
}

async function copyShareText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

async function shareMilestoneImage(input: {
  groupName?: string
  crossed: ExactMilestone[]
  exactHits: number
  shareLink: string | null
}): Promise<{ ok: boolean; notice: DownloadNotice }> {
  const card = buildMilestoneShareCardData({
    groupName: input.groupName ?? 'Palpitae',
    crossed: input.crossed,
    exactHits: input.exactHits,
    origin: window.location.origin,
    groupLink: input.shareLink,
  })
  if (!card) return { ok: true, notice: null }
  trackEvent('click_resumo_marco_compartilhar')
  try {
    const blob = await renderMilestoneShareCardBlob(card)
    if (!blob) return { ok: false, notice: null }
    const text = milestoneShareText(card, input.shareLink)
    const result = await shareOrDownloadImage(blob, milestoneShareFileName(card.milestone), text)
    if (result === 'shared') {
      trackShareInvite('native', 'exact_milestone')
      return { ok: true, notice: null }
    }
    if (result === 'cancelled') return { ok: true, notice: null }

    // Desktop / falha do menu: a imagem baixou; o link vai no clipboard (e já
    // está no rodapé do PNG).
    if (input.shareLink) {
      const copied = await copyShareText(text)
      if (copied) {
        trackShareInvite('copy_link', 'exact_milestone')
        return { ok: true, notice: { kind: 'copied' } }
      }
      return { ok: true, notice: { kind: 'manual', link: input.shareLink } }
    }
    return { ok: true, notice: { kind: 'downloaded' } }
  } catch {
    return { ok: false, notice: null }
  }
}

/** Botões de compartilhar rodada e marco, com estado e erro locais. */
export function RoundShareActions({
  groupName,
  roundLabel,
  postponed,
  own,
  standings,
  self,
  crossed,
  exactHits,
  shareLink,
}: RoundShareActionsProps) {
  const [sharing, setSharing] = useState(false)
  const [sharingMilestone, setSharingMilestone] = useState(false)
  const [shareError, setShareError] = useState(false)
  const [downloadNotice, setDownloadNotice] = useState<DownloadNotice>(null)

  const canShareRound = Boolean(self && standings)
  if (!canShareRound && crossed.length === 0) return null

  async function onShareRound() {
    if (!standings || !self) return
    setSharing(true)
    setShareError(false)
    setDownloadNotice(null)
    const ok = await shareRoundImage({
      groupName,
      roundLabel,
      postponed,
      own,
      standings,
      self,
    })
    if (!ok) setShareError(true)
    setSharing(false)
  }

  async function onShareMilestone() {
    setSharingMilestone(true)
    setShareError(false)
    setDownloadNotice(null)
    const { ok, notice } = await shareMilestoneImage({
      groupName,
      crossed,
      exactHits,
      shareLink,
    })
    if (!ok) setShareError(true)
    else setDownloadNotice(notice)
    setSharingMilestone(false)
  }

  return (
    <div className={styles.actions}>
      {canShareRound && (
        <Button variant="outline" size="sm" onClick={onShareRound} disabled={sharing}>
          {sharing ? 'Gerando imagem...' : 'Compartilhar rodada'}
        </Button>
      )}
      {crossed.length > 0 && (
        <Button
          variant="primary"
          size="sm"
          onClick={onShareMilestone}
          disabled={sharingMilestone}
        >
          {sharingMilestone ? 'Gerando imagem...' : 'Compartilhar marco'}
        </Button>
      )}
      {shareError && (
        <span className={styles.error} role="alert">
          Não foi possível gerar a imagem neste navegador.
        </span>
      )}
      {downloadNotice?.kind === 'copied' && (
        <span className={styles.noticeOk} role="status">
          Imagem baixada e link copiado
        </span>
      )}
      {downloadNotice?.kind === 'downloaded' && (
        <span className={styles.noticeOk} role="status">
          Imagem baixada
        </span>
      )}
      {downloadNotice?.kind === 'manual' && (
        <span className={styles.noticeManual} role="status">
          Imagem baixada. Copie o link:{' '}
          <a href={downloadNotice.link} className={styles.noticeLink}>
            {downloadNotice.link}
          </a>
        </span>
      )}
    </div>
  )
}
