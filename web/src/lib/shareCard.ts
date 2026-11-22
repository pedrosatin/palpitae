/**
 * Cartão de compartilhamento — o resultado final de um bolão, desenhado como uma
 * linha da tabela de classificação arrancada e ampliada. A colocação é o herói
 * (numeral de placar em lime); o pódio fica ghostado abaixo para que um estranho
 * leia a história inteira ("venceu N de M") num relance.
 *
 * Renderiza num <canvas> — PNG real, compartilhável como arquivo em redes sociais.
 * Sem dependência de fonte externa (stack de sistema, coerente com a marca).
 */
import type { RankedGroup } from './groupPosition'
import {
  ASH,
  BONE,
  BORDER,
  FONT,
  INK,
  LIME,
  PAD,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  drawEyebrow,
  drawFooter,
  fillTracked,
  hline,
  renderCardBlob,
  stripScheme,
  truncate,
  withSelfRow,
  type ShareRow,
} from './shareCardParts'

export interface ShareCardData {
  competition: string
  position: number
  total: number
  isChampion: boolean
  standings: ShareRow[]
  domain: string
}

/**
 * Traduz um grupo encerrado no dado do cartão. Puro e testável — não toca canvas.
 * Reaproveita o pódio que a API já entrega pro card encerrado.
 */
export function buildShareCardData(group: RankedGroup, origin: string): ShareCardData {
  const podium = group.podium ?? []
  const podiumRows: ShareRow[] = podium.map((e) => ({
    position: e.position,
    display: e.is_you ? 'Você' : firstName(e.display),
    points: e.points,
    isYou: e.is_you,
  }))
  const standings = withSelfRow(podiumRows, {
    position: group.user_position,
    points: group.user_points,
  })

  return {
    competition: group.competition_name ?? group.competition_id,
    position: group.user_position,
    total: group.member_count,
    isChampion: group.user_position === 1,
    standings,
    domain: stripScheme(origin),
  }
}

/**
 * Só o primeiro nome — o cartão é público (posta em redes sociais), então
 * exibir sobrenome de terceiros seria vazamento de dado pessoal. Você continua
 * sendo "Você".
 */
export function firstName(display: string): string {
  return display.trim().split(/\s+/)[0] || display
}

/**
 * Pinta o cartão inteiro no contexto. Coordenadas absolutas em 1080×1350.
 */
export function drawShareCard(ctx: CanvasRenderingContext2D, data: ShareCardData): void {
  const W = SHARE_CARD_WIDTH
  const H = SHARE_CARD_HEIGHT

  ctx.fillStyle = INK
  ctx.fillRect(0, 0, W, H)

  drawEyebrow(ctx, data.competition)

  ctx.textAlign = 'center'
  if (data.isChampion) {
    ctx.font = `100px ${FONT}`
    ctx.fillText('🏆', W / 2, 288)
  }

  ctx.fillStyle = ASH
  ctx.font = `700 34px ${FONT}`
  const label = data.isChampion ? 'CAMPEÃO DO BOLÃO' : 'FIQUEI EM'
  fillTracked(ctx, label, W / 2, data.isChampion ? 372 : 360, 8)

  const heroY = 556
  const numStr = String(data.position)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = LIME
  ctx.font = `800 360px ${FONT}`
  const nw = ctx.measureText(numStr).width
  ctx.font = `800 130px ${FONT}`
  const ow = ctx.measureText('º').width
  const startX = (W - (nw + ow)) / 2
  ctx.font = `800 360px ${FONT}`
  ctx.fillText(numStr, startX, heroY)
  ctx.font = `800 130px ${FONT}`
  ctx.fillText('º', startX + nw, heroY - 95)

  ctx.strokeStyle = LIME
  ctx.lineWidth = 6
  hline(ctx, W / 2 - 110, heroY + 206, W / 2 + 110)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ASH
  ctx.font = `500 40px ${FONT}`
  ctx.fillText(`de ${data.total} no bolão`, W / 2, heroY + 280)

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 2
  hline(ctx, PAD, 900, W - PAD)

  const rows = data.standings.slice(0, 4)
  const rowH = rows.length > 3 ? 68 : 82
  const startY = 968
  ctx.textBaseline = 'middle'
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const y = startY + i * rowH
    const champ = row.position === 1
    const accent = row.isYou || champ
    ctx.fillStyle = accent ? LIME : BONE

    ctx.textAlign = 'left'
    ctx.font = `700 34px ${FONT}`
    ctx.fillStyle = champ ? LIME : row.isYou ? LIME : ASH
    ctx.fillText(champ ? '🏆' : `${row.position}`, PAD + 8, y)

    ctx.fillStyle = accent ? LIME : BONE
    ctx.font = `${row.isYou ? 700 : 500} 38px ${FONT}`
    ctx.fillText(truncate(ctx, row.display, 560), PAD + 90, y)

    ctx.textAlign = 'right'
    ctx.font = `700 38px ${FONT}`
    ctx.fillText(`${row.points}`, W - PAD, y)
  }

  drawFooter(ctx, 'dispute o topo da classificação', data.domain)
}

/** Renderiza o cartão num PNG. `null` quando o canvas não existe (jsdom). */
export function renderShareCardBlob(data: ShareCardData): Promise<Blob | null> {
  return renderCardBlob((ctx) => drawShareCard(ctx, data))
}
