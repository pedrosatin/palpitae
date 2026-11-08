/**
 * Cartão de compartilhamento da rodada. Mesmo estilo do cartão de fim de campeonato
 * (ver shareCard.ts), com os pontos do jogador como herói e o top 3 da rodada abaixo.
 * Retrato 1080×1350, desenhado num <canvas> no cliente, sem dependência nova.
 *
 * O cartão é público. Mostra só o primeiro nome dos outros membros, e um nome que
 * seja e-mail mascarado vira "Palpiteiro". Nenhum e-mail sai na imagem.
 */
import {
  ASH,
  BONE,
  BORDER,
  FONT,
  INK,
  LIME,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  fillTracked,
  firstName,
  hline,
  truncate,
} from './shareCard'
import {
  pointsLabel,
  postponedNotice,
  roundLeaders,
  type RoundStanding,
  type RoundTally,
} from './roundSummary'

export interface RoundShareEntry {
  position: number
  display: string
  points: number
  isYou: boolean
}

export interface RoundShareCardData {
  groupName: string
  roundLabel: string
  points: number
  /** Colocação do jogador na rodada e quantos membros disputaram. */
  position: number
  total: number
  exact: number
  correct: number
  /** Top 3 da rodada e, se o jogador ficou fora dele, a linha dele. */
  standings: RoundShareEntry[]
  /** Quem compartilha está entre os líderes da rodada, pela regra de `roundLeaders`. */
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

function stripScheme(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
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
  const entries: RoundShareEntry[] = standings.slice(0, TOP).map((s) => ({
    position: s.position,
    display: s.isYou ? 'Você' : cardName(s.display),
    points: s.points,
    isYou: s.isYou,
  }))
  if (!entries.some((e) => e.isYou)) {
    entries.push({ position: self.position, display: 'Você', points: self.points, isYou: true })
  }
  return {
    groupName: input.groupName,
    roundLabel: input.roundLabel,
    points: self.points,
    position: self.position,
    total: standings.length,
    exact: self.exact,
    correct: self.correct,
    standings: entries,
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
  const P = 80

  ctx.fillStyle = INK
  ctx.fillRect(0, 0, W, H)

  // Eyebrow: wordmark e grupo.
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = BONE
  ctx.font = `800 34px ${FONT}`
  let wx = P
  for (const ch of 'PALPITAE') {
    ctx.fillText(ch, wx, 118)
    wx += ctx.measureText(ch).width + 4
  }
  ctx.textAlign = 'right'
  ctx.fillStyle = ASH
  ctx.font = `600 28px ${FONT}`
  ctx.fillText(truncate(ctx, data.groupName.toUpperCase(), 460), W - P, 118)

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 2
  hline(ctx, P, 158, W - P)

  // Título do líder, na faixa livre entre o divisor do topo e o nome da rodada.
  ctx.textAlign = 'center'
  if (data.isRoundLeader) {
    ctx.fillStyle = LIME
    ctx.font = `800 40px ${FONT}`
    ctx.fillText('REI DA RODADA', W / 2, 226)
  }

  // Rodada.
  ctx.fillStyle = ASH
  ctx.font = `700 34px ${FONT}`
  fillTracked(ctx, data.roundLabel.toUpperCase(), W / 2, 280, 8)

  // Herói: pontos da rodada.
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
  hline(ctx, P, 960, W - P)

  // Top 3 da rodada e a sua linha.
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
    ctx.fillText(`${row.position}`, P + 8, y)
    ctx.fillStyle = row.isYou ? LIME : BONE
    ctx.font = `${row.isYou ? 700 : 500} 38px ${FONT}`
    ctx.fillText(truncate(ctx, row.display, 560), P + 90, y)
    ctx.textAlign = 'right'
    ctx.font = `700 38px ${FONT}`
    ctx.fillText(`${row.points}`, W - P, y)
  }

  // Rodapé.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ASH
  ctx.font = `500 30px ${FONT}`
  ctx.fillText(data.notice ?? 'dispute o topo da classificação', W / 2, H - 100)
  ctx.fillStyle = LIME
  ctx.font = `700 44px ${FONT}`
  ctx.fillText(data.domain, W / 2, H - 50)
}

/** Renderiza o cartão num PNG. `null` quando o canvas não existe (jsdom). */
export async function renderRoundShareCardBlob(data: RoundShareCardData): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_CARD_WIDTH
  canvas.height = SHARE_CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  drawRoundShareCard(ctx, data)
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}
