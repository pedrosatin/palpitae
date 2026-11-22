/**
 * Cartão de compartilhamento do marco de placares exatos. Mesmo estilo dos
 * cartões de rodada e classificação; o herói é o limiar cruzado. O texto do
 * compartilhamento e o rodapé da imagem levam o link do grupo (convite ou
 * pedido de entrada).
 */
import {
  exactMilestoneShareHighlightText,
  type ExactMilestone,
} from './exactMilestones'
import {
  ASH,
  BONE,
  FONT,
  INK,
  LIME,
  PAD,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  drawEyebrow,
  fillTracked,
  hline,
  renderCardBlob,
  stripScheme,
} from './shareCardParts'

export interface MilestoneShareCardData {
  groupName: string
  milestone: ExactMilestone
  crossed: ExactMilestone[]
  exactHits: number
  domain: string
  groupLink: string | null
}

export function buildMilestoneShareCardData(input: {
  groupName: string
  crossed: ExactMilestone[]
  exactHits: number
  origin: string
  groupLink?: string | null
}): MilestoneShareCardData | null {
  if (input.crossed.length === 0) return null
  const milestone = input.crossed[input.crossed.length - 1]
  return {
    groupName: input.groupName,
    milestone,
    crossed: input.crossed,
    exactHits: input.exactHits,
    domain: stripScheme(input.origin),
    groupLink: input.groupLink ?? null,
  }
}

/** Texto que acompanha a imagem; `groupLink` entra quando há link do grupo. */
export function milestoneShareText(data: MilestoneShareCardData, groupLink?: string | null): string {
  const highlight = exactMilestoneShareHighlightText(data.crossed) ?? ''
  const link = groupLink ?? data.groupLink
  const base = `${highlight} no bolão "${data.groupName}" no Palpitae. Já são ${data.exactHits} placares exatos.`
  if (link) return `${base} Entra com a gente: ${link}`
  return `${base} ${data.domain}`
}

export function milestoneShareFileName(milestone: ExactMilestone): string {
  return `palpitae-marco-${milestone}-exatos.png`
}

function footerLinkLabel(data: MilestoneShareCardData): string {
  if (data.groupLink) return stripScheme(data.groupLink)
  return data.domain
}

/** Largura útil do rodapé (cartão menos as duas margens). */
export const MILESTONE_FOOTER_MAX_WIDTH = SHARE_CARD_WIDTH - PAD * 2

const FOOTER_LINK_FONT_MAX = 36
const FOOTER_LINK_FONT_MIN = 22

/**
 * Parte o link em duas linhas sem perder caracteres. Prefere quebrar depois
 * de `/`; se não houver barra útil, parte no meio.
 */
export function splitFooterLink(label: string): [string, string] {
  if (!label.includes('/')) {
    const mid = Math.ceil(label.length / 2)
    return [label.slice(0, mid), label.slice(mid)]
  }
  const parts = label.split('/')
  let best = 1
  let bestScore = Number.POSITIVE_INFINITY
  for (let i = 1; i < parts.length; i++) {
    const left = parts.slice(0, i).join('/')
    const right = parts.slice(i).join('/')
    if (!left || !right) continue
    const score = Math.abs(left.length - right.length)
    if (score < bestScore) {
      best = i
      bestScore = score
    }
  }
  return [parts.slice(0, best).join('/') + '/', parts.slice(best).join('/')]
}

export interface FooterLinkLayout {
  fontSize: number
  lines: [string] | [string, string]
}

/**
 * Escolhe tamanho de fonte e uma ou duas linhas para o link caber na largura
 * útil, sem truncar. Reduz a fonte até o mínimo se as duas linhas ainda
 * estourarem.
 */
export function layoutFooterLink(
  measure: (text: string, fontSize: number) => number,
  label: string,
  maxWidth: number = MILESTONE_FOOTER_MAX_WIDTH,
): FooterLinkLayout {
  for (let fontSize = FOOTER_LINK_FONT_MAX; fontSize >= FOOTER_LINK_FONT_MIN; fontSize -= 1) {
    if (measure(label, fontSize) <= maxWidth) {
      return { fontSize, lines: [label] }
    }
    const [left, right] = splitFooterLink(label)
    if (measure(left, fontSize) <= maxWidth && measure(right, fontSize) <= maxWidth) {
      return { fontSize, lines: [left, right] }
    }
  }
  const [left, right] = splitFooterLink(label)
  return { fontSize: FOOTER_LINK_FONT_MIN, lines: [left, right] }
}

function drawMilestoneFooter(ctx: CanvasRenderingContext2D, data: MilestoneShareCardData): void {
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

/** Pinta o cartão inteiro no contexto. Coordenadas absolutas em 1080×1350. */
export function drawMilestoneShareCard(
  ctx: CanvasRenderingContext2D,
  data: MilestoneShareCardData,
): void {
  const W = SHARE_CARD_WIDTH
  const H = SHARE_CARD_HEIGHT

  ctx.fillStyle = INK
  ctx.fillRect(0, 0, W, H)

  drawEyebrow(ctx, data.groupName)

  ctx.textAlign = 'center'
  ctx.fillStyle = LIME
  ctx.font = `800 40px ${FONT}`
  ctx.fillText('MARCO ATINGIDO', W / 2, 226)

  ctx.fillStyle = ASH
  ctx.font = `700 34px ${FONT}`
  fillTracked(ctx, 'PLACARES EXATOS', W / 2, 280, 8)

  const heroY = 520
  ctx.textBaseline = 'middle'
  ctx.fillStyle = LIME
  ctx.font = `800 360px ${FONT}`
  ctx.fillText(String(data.milestone), W / 2, heroY)
  ctx.strokeStyle = LIME
  ctx.lineWidth = 6
  hline(ctx, W / 2 - 110, heroY + 206, W / 2 + 110)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ASH
  ctx.font = `500 40px ${FONT}`
  ctx.fillText('placares exatos no grupo', W / 2, heroY + 280)
  ctx.fillStyle = BONE
  ctx.font = `600 40px ${FONT}`
  ctx.fillText(`Total agora: ${data.exactHits}`, W / 2, heroY + 360)

  if (data.crossed.length > 1) {
    ctx.fillStyle = ASH
    ctx.font = `500 34px ${FONT}`
    ctx.fillText(`Também cruzou: ${data.crossed.slice(0, -1).join(', ')}`, W / 2, heroY + 420)
  }

  drawMilestoneFooter(ctx, data)
}

/** Renderiza o cartão num PNG. `null` quando o canvas não existe (jsdom). */
export function renderMilestoneShareCardBlob(data: MilestoneShareCardData): Promise<Blob | null> {
  return renderCardBlob((ctx) => drawMilestoneShareCard(ctx, data))
}
