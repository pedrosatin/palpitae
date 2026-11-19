/**
 * Cartão de compartilhamento do marco de placares exatos. Mesmo estilo dos
 * cartões de rodada e classificação; o herói é o limiar cruzado. O texto do
 * compartilhamento inclui o link do grupo (convite ou pedido de entrada).
 */
import { exactMilestoneHighlightText, type ExactMilestone } from './exactMilestones'
import {
  ASH,
  BONE,
  FONT,
  INK,
  LIME,
  drawEyebrow,
  drawFooter,
  fillTracked,
  hline,
  renderCardBlob,
  stripScheme,
} from './shareCardParts'

export interface MilestoneShareCardData {
  groupName: string
  milestone: ExactMilestone
  /** Todos os limiares cruzados nesta rodada (pode ser mais de um). */
  crossed: ExactMilestone[]
  exactHits: number
  domain: string
}

export function buildMilestoneShareCardData(input: {
  groupName: string
  crossed: ExactMilestone[]
  exactHits: number
  origin: string
}): MilestoneShareCardData | null {
  if (input.crossed.length === 0) return null
  const milestone = input.crossed[input.crossed.length - 1]
  return {
    groupName: input.groupName,
    milestone,
    crossed: input.crossed,
    exactHits: input.exactHits,
    domain: stripScheme(input.origin),
  }
}

/** Texto que acompanha a imagem; `groupLink` entra quando há link do grupo. */
export function milestoneShareText(data: MilestoneShareCardData, groupLink?: string | null): string {
  const highlight = exactMilestoneHighlightText(data.crossed) ?? ''
  const base = `${highlight} no bolão "${data.groupName}" no Palpitae. Já são ${data.exactHits} placares exatos.`
  if (groupLink) return `${base} Entra com a gente: ${groupLink}`
  return `${base} ${data.domain}`
}

export function milestoneShareFileName(milestone: ExactMilestone): string {
  return `palpitae-marco-${milestone}-exatos.png`
}

/** Pinta o cartão inteiro no contexto. Coordenadas absolutas em 1080×1350. */
export function drawMilestoneShareCard(
  ctx: CanvasRenderingContext2D,
  data: MilestoneShareCardData,
): void {
  const W = 1080
  const H = 1350

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

  drawFooter(ctx, 'traga a galera pro bolão', data.domain)
}

/** Renderiza o cartão num PNG. `null` quando o canvas não existe (jsdom). */
export function renderMilestoneShareCardBlob(data: MilestoneShareCardData): Promise<Blob | null> {
  return renderCardBlob((ctx) => drawMilestoneShareCard(ctx, data))
}
