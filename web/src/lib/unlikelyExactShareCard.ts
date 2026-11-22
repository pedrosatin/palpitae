/**
 * Cartão de compartilhamento do placar improvável. Mesmo estilo dos cartões
 * de marco e de rodada; o destaque é o limiar público (no máximo 10%), sem
 * percentual nem contagens do jogo. O texto e o rodapé levam o link do grupo
 * (convite ou pedido de entrada).
 */
import {
  UNLIKELY_EXACT_THRESHOLD_PERCENT,
  unlikelyExactShareHighlightText,
} from './unlikelyExact'
import {
  ASH,
  BONE,
  FONT,
  INK,
  LIME,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  drawEyebrow,
  fillTracked,
  hline,
  renderCardBlob,
  stripScheme,
} from './shareCardParts'
import {
  layoutFooterLink,
  MILESTONE_FOOTER_MAX_WIDTH,
} from './milestoneShareCard'

export interface UnlikelyExactShareCardData {
  groupName: string
  domain: string
  groupLink: string | null
}

export function buildUnlikelyExactShareCardData(input: {
  groupName: string
  hasUnlikelyExact: boolean
  origin: string
  groupLink?: string | null
}): UnlikelyExactShareCardData | null {
  if (!input.hasUnlikelyExact) return null
  return {
    groupName: input.groupName,
    domain: stripScheme(input.origin),
    groupLink: input.groupLink ?? null,
  }
}

export function unlikelyExactShareText(
  data: UnlikelyExactShareCardData,
  groupLink?: string | null,
): string {
  const highlight = unlikelyExactShareHighlightText(true) ?? ''
  const link = groupLink ?? data.groupLink
  const base = `${highlight} no bolão "${data.groupName}" no Palpitae.`
  if (link) return `${base} Entra com a gente: ${link}`
  return `${base} ${data.domain}`
}

export function unlikelyExactShareFileName(): string {
  return 'palpitae-placar-improvavel.png'
}

function footerLinkLabel(data: UnlikelyExactShareCardData): string {
  if (data.groupLink) return stripScheme(data.groupLink)
  return data.domain
}

function drawUnlikelyFooter(ctx: CanvasRenderingContext2D, data: UnlikelyExactShareCardData): void {
  const W = SHARE_CARD_WIDTH
  const H = SHARE_CARD_HEIGHT
  const label = footerLinkLabel(data)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ASH
  ctx.font = `500 30px ${FONT}`
  ctx.fillText('traga a galera pro bolão', W / 2, H - 120)

  const layout = layoutFooterLink(
    (text, fontSize) => {
      ctx.font = `700 ${fontSize}px ${FONT}`
      return ctx.measureText(text).width
    },
    label,
    MILESTONE_FOOTER_MAX_WIDTH,
  )
  ctx.fillStyle = LIME
  ctx.font = `700 ${layout.fontSize}px ${FONT}`
  if (layout.lines.length === 1) {
    ctx.fillText(layout.lines[0], W / 2, H - 55)
  } else {
    ctx.fillText(layout.lines[0], W / 2, H - 78)
    ctx.fillText(layout.lines[1], W / 2, H - 42)
  }
}

export function drawUnlikelyExactShareCard(
  ctx: CanvasRenderingContext2D,
  data: UnlikelyExactShareCardData,
): void {
  const W = SHARE_CARD_WIDTH
  const H = SHARE_CARD_HEIGHT

  ctx.fillStyle = INK
  ctx.fillRect(0, 0, W, H)

  drawEyebrow(ctx, data.groupName)

  ctx.textAlign = 'center'
  ctx.fillStyle = LIME
  ctx.font = `800 40px ${FONT}`
  ctx.fillText('PLACAR IMPROVÁVEL', W / 2, 226)

  ctx.fillStyle = ASH
  ctx.font = `700 34px ${FONT}`
  fillTracked(ctx, 'NA COMPETIÇÃO INTEIRA', W / 2, 280, 8)

  const heroY = 480
  ctx.textBaseline = 'middle'
  ctx.fillStyle = LIME
  ctx.font = `800 120px ${FONT}`
  ctx.fillText(`< ${UNLIKELY_EXACT_THRESHOLD_PERCENT}%`, W / 2, heroY)
  ctx.strokeStyle = LIME
  ctx.lineWidth = 6
  hline(ctx, W / 2 - 200, heroY + 100, W / 2 + 200)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ASH
  ctx.font = `500 40px ${FONT}`
  ctx.fillText('dos palpiteiros cravaram', W / 2, heroY + 180)
  ctx.fillStyle = BONE
  ctx.font = `600 40px ${FONT}`
  ctx.fillText('o mesmo placar exato', W / 2, heroY + 260)

  drawUnlikelyFooter(ctx, data)
}

export function renderUnlikelyExactShareCardBlob(
  data: UnlikelyExactShareCardData,
): Promise<Blob | null> {
  return renderCardBlob((ctx) => drawUnlikelyExactShareCard(ctx, data))
}
