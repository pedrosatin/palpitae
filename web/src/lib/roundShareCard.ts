/**
 * Cartão de compartilhamento da rodada. Mesmo estilo do cartão de fim de campeonato
 * (ver shareCard.ts), com os pontos do jogador como herói e o top 3 da rodada abaixo.
 * Retrato 1080×1350, desenhado num <canvas> no cliente, sem dependência nova.
 *
 * O cartão é público. Mostra só o primeiro nome dos outros membros, e um nome que
 * seja e-mail mascarado vira "Palpiteiro". Nenhum e-mail sai na imagem.
 */
import { firstName } from './shareCard'
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
import {
  pointsLabel,
  postponedNotice,
  roundLeaders,
  type RoundStanding,
  type RoundTally,
} from './roundSummary'

export interface RoundShareCardData {
  groupName: string
  roundLabel: string
  points: number
  position: number
  total: number
  exact: number
  correct: number
  standings: ShareRow[]
  isRoundLeader: boolean
  notice: string | null
  domain: string
}

const TOP = 3

/** Nome seguro para a imagem. E-mail mascarado da API ("ab***@dominio") não sai. */
export function cardName(display: string): string {
  if (display.includes('@')) return 'Palpiteiro'
  return firstName(display)
}

/** Traduz a classificação da rodada no dado do cartão. Puro, sem canvas. */
export function buildRoundShareCardData(input: {
  groupName: string
  roundLabel: string
  standings: RoundStanding[]
  self: RoundTally & { position: number }
  postponed: number
  origin: string
}): RoundShareCardData {
  const { standings, self } = input
  const entries: ShareRow[] = standings.slice(0, TOP).map((s) => ({
    position: s.position,
    display: s.isYou ? 'Você' : cardName(s.display),
    points: s.points,
    isYou: s.isYou,
  }))
  return {
    groupName: input.groupName,
    roundLabel: input.roundLabel,
    points: self.points,
    position: self.position,
    total: standings.length,
    exact: self.exact,
    correct: self.correct,
    standings: withSelfRow(entries, self),
    isRoundLeader: roundLeaders(standings).some((s) => s.isYou),
    notice: postponedNotice(input.postponed),
    domain: stripScheme(input.origin),
  }
}

function statsLine(data: RoundShareCardData): string {
  const parts: string[] = []
  if (data.exact > 0) parts.push(`${data.exact} ${data.exact === 1 ? 'exato' : 'exatos'}`)
  parts.push(`${data.correct} ${data.correct === 1 ? 'resultado certo' : 'resultados certos'}`)
  return parts.join('  ·  ')
}

/** Texto que acompanha a imagem no compartilhamento. */
export function roundShareText(data: RoundShareCardData): string {
  const title = data.isRoundLeader ? ' Levei o título de rei da rodada.' : ''
  return `Fiz ${pointsLabel(data.points)} na ${data.roundLabel.toLowerCase()} do bolão "${data.groupName}" no Palpitae. Fiquei em ${data.position}º de ${data.total}.${title} ${data.domain}`
}

export function roundShareFileName(roundLabel: string): string {
  const slug = roundLabel
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `palpitae-${slug || 'rodada'}.png`
}

/** Pinta o cartão inteiro no contexto. Coordenadas absolutas em 1080×1350. */
export function drawRoundShareCard(ctx: CanvasRenderingContext2D, data: RoundShareCardData): void {
  const W = SHARE_CARD_WIDTH
  const H = SHARE_CARD_HEIGHT

  ctx.fillStyle = INK
  ctx.fillRect(0, 0, W, H)

  drawEyebrow(ctx, data.groupName)

  ctx.textAlign = 'center'
  if (data.isRoundLeader) {
    ctx.fillStyle = LIME
    ctx.font = `800 40px ${FONT}`
    ctx.fillText('REI DA RODADA', W / 2, 226)
  }

  ctx.fillStyle = ASH
  ctx.font = `700 34px ${FONT}`
  fillTracked(ctx, data.roundLabel.toUpperCase(), W / 2, 280, 8)

  const heroY = 500
  ctx.textBaseline = 'middle'
  ctx.fillStyle = LIME
  ctx.font = `800 360px ${FONT}`
  ctx.fillText(String(data.points), W / 2, heroY)
  ctx.strokeStyle = LIME
  ctx.lineWidth = 6
  hline(ctx, W / 2 - 110, heroY + 206, W / 2 + 110)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ASH
  ctx.font = `500 40px ${FONT}`
  ctx.fillText(data.points === 1 ? 'ponto na rodada' : 'pontos na rodada', W / 2, heroY + 280)
  ctx.fillStyle = BONE
  ctx.font = `600 40px ${FONT}`
  ctx.fillText(`${data.position}º de ${data.total} na rodada`, W / 2, heroY + 340)
  ctx.fillStyle = ASH
  ctx.font = `500 34px ${FONT}`
  ctx.fillText(statsLine(data), W / 2, heroY + 392)

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 2
  hline(ctx, PAD, 960, W - PAD)

  const rows = data.standings.slice(0, 4)
  const rowH = rows.length > 3 ? 64 : 76
  const startY = 1020
  ctx.textBaseline = 'middle'
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const y = startY + i * rowH
    ctx.textAlign = 'left'
    ctx.font = `700 34px ${FONT}`
    ctx.fillStyle = row.isYou || row.position === 1 ? LIME : ASH
    ctx.fillText(`${row.position}`, PAD + 8, y)
    ctx.fillStyle = row.isYou ? LIME : BONE
    ctx.font = `${row.isYou ? 700 : 500} 38px ${FONT}`
    ctx.fillText(truncate(ctx, row.display, 560), PAD + 90, y)
    ctx.textAlign = 'right'
    ctx.font = `700 38px ${FONT}`
    ctx.fillText(`${row.points}`, W - PAD, y)
  }

  drawFooter(ctx, data.notice ?? 'dispute o topo da classificação', data.domain)
}

/** Renderiza o cartão num PNG. `null` quando o canvas não existe (jsdom). */
export function renderRoundShareCardBlob(data: RoundShareCardData): Promise<Blob | null> {
  return renderCardBlob((ctx) => drawRoundShareCard(ctx, data))
}
