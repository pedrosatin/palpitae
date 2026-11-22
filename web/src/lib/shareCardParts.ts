/**
 * Partes comuns dos cartões de compartilhamento (classificação em shareCard.ts e
 * rodada em roundShareCard.ts): tamanho, cores, cabeçalho, rodapé, linha "Você" e
 * geração do PNG. O laço da tabela de cada cartão continua no arquivo dele.
 */

/** Proporção retrato 1080×1350 — Stories (IG/WhatsApp) e feed. */
export const SHARE_CARD_WIDTH = 1080
export const SHARE_CARD_HEIGHT = 1350

export const INK = '#0d0d0d'
export const LIME = '#49f21b'
export const BONE = '#ffffff'
export const ASH = '#a3a3a3'
export const BORDER = '#2a2a2a'

export const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif"

/** Margem lateral do cartão. */
export const PAD = 80

export interface ShareRow {
  position: number
  display: string
  points: number
  isYou: boolean
}

export function stripScheme(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/** Anexa a linha "Você" quando o jogador ficou fora das linhas mostradas. */
export function withSelfRow(
  rows: ShareRow[],
  self: { position: number; points: number },
): ShareRow[] {
  if (rows.some((r) => r.isYou)) return rows
  return [...rows, { position: self.position, display: 'Você', points: self.points, isYou: true }]
}

/** Desenha texto com tracking (espaçamento entre letras) — canvas não tem nativo. */
export function fillTracked(
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
export function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
  return t + '…'
}

export function hline(ctx: CanvasRenderingContext2D, x1: number, y: number, x2: number): void {
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
}

/** Cabeçalho: wordmark à esquerda, `title` (campeonato ou grupo) à direita e a linha-base. */
export function drawEyebrow(ctx: CanvasRenderingContext2D, title: string): void {
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = BONE
  ctx.font = `800 34px ${FONT}`
  ctx.save()
  let wx = PAD
  for (const ch of 'PALPITAE') {
    ctx.fillText(ch, wx, 118)
    wx += ctx.measureText(ch).width + 4
  }
  ctx.restore()

  ctx.textAlign = 'right'
  ctx.fillStyle = ASH
  ctx.font = `600 28px ${FONT}`
  ctx.fillText(truncate(ctx, title.toUpperCase(), 460), SHARE_CARD_WIDTH - PAD, 118)

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 2
  hline(ctx, PAD, 158, SHARE_CARD_WIDTH - PAD)
}

/** Rodapé: `tagline` e o domínio em lime. */
export function drawFooter(ctx: CanvasRenderingContext2D, tagline: string, domain: string): void {
  const W = SHARE_CARD_WIDTH
  const H = SHARE_CARD_HEIGHT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ASH
  ctx.font = `500 30px ${FONT}`
  ctx.fillText(tagline, W / 2, H - 100)
  ctx.fillStyle = LIME
  ctx.font = `700 44px ${FONT}`
  ctx.fillText(domain, W / 2, H - 50)
}

/**
 * Renderiza o cartão num PNG. Retorna `null` se o canvas não estiver disponível
 * (ex.: jsdom em testes) — o chamador degrada graciosamente.
 */
export async function renderCardBlob(
  draw: (ctx: CanvasRenderingContext2D) => void,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_CARD_WIDTH
  canvas.height = SHARE_CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  draw(ctx)

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}
