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

async function shareMilestoneImage(input: {
  groupName?: string
  crossed: ExactMilestone[]
  exactHits: number
  shareLink: string | null
}): Promise<boolean> {
  const card = buildMilestoneShareCardData({
    groupName: input.groupName ?? 'Palpitae',
    crossed: input.crossed,
    exactHits: input.exactHits,
    origin: window.location.origin,
  })
  if (!card) return true
  trackEvent('click_resumo_marco_compartilhar')
  try {
    const blob = await renderMilestoneShareCardBlob(card)
    if (!blob) return false
    const result = await shareOrDownloadImage(
      blob,
      milestoneShareFileName(card.milestone),
      milestoneShareText(card, input.shareLink),
    )
    if (result === 'shared') {
      trackShareInvite('native', 'exact_milestone')
    }
    return true
  } catch {
    return false
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

  const canShareRound = Boolean(self && standings)
  if (!canShareRound && crossed.length === 0) return null

  async function onShareRound() {
    if (!standings || !self) return
    setSharing(true)
    setShareError(false)
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
    const ok = await shareMilestoneImage({ groupName, crossed, exactHits, shareLink })
    if (!ok) setShareError(true)
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
    </div>
  )
}
