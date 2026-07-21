/**
 * Cartão de compartilhamento — o resultado final de um bolão, desenhado como uma
 * linha da tabela de classificação arrancada e ampliada. A colocação é o herói
 * (numeral de placar em lime); o pódio fica ghostado abaixo para que um estranho
 * leia a história inteira ("venceu N de M") num relance.
 *
 * Renderiza num <canvas> — PNG real, compartilhável como arquivo em redes sociais.
 * Sem dependência de fonte externa (stack de sistema, coerente com a marca).
 */
import type { GroupWithStats } from '../components/GroupCard'

/** Proporção retrato 1080×1350 — Stories (IG/WhatsApp) e feed. */
export const SHARE_CARD_WIDTH = 1080
export const SHARE_CARD_HEIGHT = 1350

const INK = '#0d0d0d'
const LIME = '#49f21b'
const BONE = '#ffffff'
const ASH = '#a3a3a3'
const BORDER = '#2a2a2a'

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif"

export interface ShareCardEntry {
  position: number
  display: string
  points: number
  isYou: boolean
}

export interface ShareCardData {
  competition: string
  position: number
  total: number
  isChampion: boolean
  /** Linhas a mostrar: top-3 do pódio + a sua, se você ficou fora dele. */
  standings: ShareCardEntry[]
  /** Domínio exibido no rodapé (link aponta pra landing). */
  domain: string
}

/**
 * Traduz um grupo encerrado no dado do cartão. Puro e testável — não toca canvas.
 * Reaproveita o pódio que a API já entrega pro card encerrado.
 */
export function buildShareCardData(group: GroupWithStats, origin: string): ShareCardData {
  const podium = group.podium ?? []
  const standings: ShareCardEntry[] = podium.map((e) => ({
    position: e.position,
    display: e.is_you ? 'Você' : firstName(e.display),
    points: e.points,
    isYou: e.is_you,
  }))

  // Você fora do top-3 → anexa sua linha para não sumir da própria conquista.
  if (!standings.some((e) => e.isYou)) {
    standings.push({
      position: group.user_position,
      display: 'Você',
      points: group.user_points,
      isYou: true,
    })
  }

  return {
    competition: group.competition_name ?? group.competition_id,
    position: group.user_position,
    total: group.member_count,
    isChampion: group.user_position === 1,
    standings,
    domain: stripScheme(origin),
  }
}

function stripScheme(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/**
 * Só o primeiro nome — o cartão é público (posta em redes sociais), então
 * exibir sobrenome de terceiros seria vazamento de dado pessoal. Você continua
 * sendo "Você".
 */
function firstName(display: string): string {
  return display.trim().split(/\s+/)[0] || display
}

/** Desenha texto com tracking (espaçamento entre letras) — canvas não tem nativo. */
function fillTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  tracking: number,
): void {
  const widths = [...text].map((ch) => ctx.measureText(ch).width + tracking)
  const total = widths.reduce((a, w) => a + w, 0) - tracking
  let x = cx - total / 2
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x, y)
    x += widths[i]
  }
}

/** Corta texto com reticências para caber em maxWidth. */
function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
  return t + '…'
}

/**
 * Pinta o cartão inteiro no contexto. Coordenadas absolutas em 1080×1350.
 */
export function drawShareCard(ctx: CanvasRenderingContext2D, data: ShareCardData): void {
  const W = SHARE_CARD_WIDTH
  const H = SHARE_CARD_HEIGHT
  const P = 80

  // Fundo
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, W, H)

  // ─── Eyebrow: wordmark + campeonato ───────────────────────────────────────
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = BONE
  ctx.font = `800 34px ${FONT}`
  ctx.save()
  // wordmark com um leve tracking, desenhado a partir da margem esquerda
  let wx = P
  for (const ch of 'PALPITAE') {
    ctx.fillText(ch, wx, 118)
    wx += ctx.measureText(ch).width + 4
  }
  ctx.restore()

  ctx.textAlign = 'right'
  ctx.fillStyle = ASH
  ctx.font = `600 28px ${FONT}`
  ctx.fillText(truncate(ctx, data.competition.toUpperCase(), 460), W - P, 118)

  // hairline
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 2
  hline(ctx, P, 158, W - P)

  // ─── Coroa (só campeão) ───────────────────────────────────────────────────
  ctx.textAlign = 'center'
  if (data.isChampion) {
    ctx.font = `100px ${FONT}`
    ctx.fillText('🏆', W / 2, 288)
  }

  // ─── Label ────────────────────────────────────────────────────────────────
  ctx.fillStyle = ASH
  ctx.font = `700 34px ${FONT}`
  const label = data.isChampion ? 'CAMPEÃO DO BOLÃO' : 'FIQUEI EM'
  fillTracked(ctx, label, W / 2, data.isChampion ? 372 : 360, 8)

  // ─── Herói: numeral de placar ─────────────────────────────────────────────
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
  ctx.fillText('º', startX + nw, heroY - 95) // ordinal elevado, folha de estatística

  // régua-base curta sob o numeral
  ctx.strokeStyle = LIME
  ctx.lineWidth = 6
  hline(ctx, W / 2 - 110, heroY + 206, W / 2 + 110)

  // caption
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ASH
  ctx.font = `500 40px ${FONT}`
  ctx.fillText(`de ${data.total} no bolão`, W / 2, heroY + 280)

  // hairline
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 2
  hline(ctx, P, 900, W - P)

  // ─── Classificação (top-3 + você) ─────────────────────────────────────────
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

    // rank / coroa
    ctx.textAlign = 'left'
    ctx.font = `700 34px ${FONT}`
    ctx.fillStyle = champ ? LIME : row.isYou ? LIME : ASH
    ctx.fillText(champ ? '🏆' : `${row.position}`, P + 8, y)

    // nome
    ctx.fillStyle = accent ? LIME : BONE
    ctx.font = `${row.isYou ? 700 : 500} 38px ${FONT}`
    ctx.fillText(truncate(ctx, row.display, 560), P + 90, y)

    // pontos
    ctx.textAlign = 'right'
    ctx.font = `700 38px ${FONT}`
    ctx.fillText(`${row.points}`, W - P, y)
  }

  // ─── Rodapé: tagline + link ───────────────────────────────────────────────
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ASH
  ctx.font = `500 30px ${FONT}`
  ctx.fillText('dispute o topo da classificação', W / 2, H - 100)
  ctx.fillStyle = LIME
  ctx.font = `700 44px ${FONT}`
  ctx.fillText(data.domain, W / 2, H - 50)
}

function hline(ctx: CanvasRenderingContext2D, x1: number, y: number, x2: number): void {
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
}

/**
 * Renderiza o cartão num PNG. Retorna `null` se o canvas não estiver disponível
 * (ex.: jsdom em testes) — o chamador degrada graciosamente.
 */
export async function renderShareCardBlob(data: ShareCardData): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_CARD_WIDTH
  canvas.height = SHARE_CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  drawShareCard(ctx, data)

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}
