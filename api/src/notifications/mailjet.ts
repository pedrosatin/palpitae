/**
 * Fallback transacional via Mailjet (API v3.1). Só entra depois de recusa
 * definitiva do Resend. Sem cabeçalho de idempotência: o CustomID
 * (`lembrete-diario/<usuário>/<dia>`) reconcilia envio incerto.
 */

import type { EmailMessage } from './email'

const MAILJET_SEND_API = 'https://api.mailjet.com/v3.1/send'
const MAILJET_MESSAGE_API = 'https://api.mailjet.com/v3/REST/message'
export const MAILJET_TIMEOUT_MS = 10_000

const FROM_EMAIL = 'lembretes@palpitae.com.br'
const FROM_NAME = 'Palpitae'

export type MailjetCredentials = {
  apiKey: string
  apiSecret: string
}

/** Credenciais usáveis: as duas precisam estar preenchidas. */
export function mailjetCredentials(
  apiKey: string | undefined,
  apiSecret: string | undefined,
): MailjetCredentials | undefined {
  const key = apiKey?.trim()
  const secret = apiSecret?.trim()
  if (!key || !secret) return undefined
  return { apiKey: key, apiSecret: secret }
}

export class MailjetError extends Error {
  readonly status: number

  constructor(status: number, _body?: string) {
    // Sem o corpo na mensagem: a API pode ecoar o destinatário e vazar no log.
    super(`Mailjet respondeu ${status}`)
    this.name = 'MailjetError'
    this.status = status
  }
}

function basicAuth(creds: MailjetCredentials): string {
  return `Basic ${btoa(`${creds.apiKey}:${creds.apiSecret}`)}`
}

/**
 * Envia um e-mail pelo Mailjet. `customId` vira o CustomID da mensagem e deve
 * ser a mesma chave de idempotência do Resend (`lembrete-diario/...`).
 */
export async function sendMailjetEmail(
  creds: MailjetCredentials,
  msg: EmailMessage,
  customId: string,
): Promise<{ messageId: string | undefined }> {
  const res = await fetch(MAILJET_SEND_API, {
    method: 'POST',
    signal: AbortSignal.timeout(MAILJET_TIMEOUT_MS),
    headers: {
      Authorization: basicAuth(creds),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: FROM_EMAIL, Name: FROM_NAME },
          To: [{ Email: msg.to }],
          Subject: msg.subject,
          HTMLPart: msg.html,
          ...(msg.text ? { TextPart: msg.text } : {}),
          ...(msg.headers ? { Headers: msg.headers } : {}),
          CustomID: customId,
        },
      ],
    }),
  })

  const body = await res.text()
  if (!res.ok) throw new MailjetError(res.status, body)

  let messageId: string | undefined
  try {
    const parsed = JSON.parse(body) as {
      Messages?: Array<{
        Status?: string
        To?: Array<{ MessageID?: number | string }>
        Errors?: unknown
      }>
    }
    const first = parsed.Messages?.[0]
    if (first && first.Status && first.Status !== 'success') {
      throw new MailjetError(res.status, body)
    }
    const id = first?.To?.[0]?.MessageID
    if (id !== undefined && id !== null) messageId = String(id)
  } catch (err) {
    if (err instanceof MailjetError) throw err
    // Corpo 2xx inesperado: o provedor aceitou o HTTP; seguimos sem MessageID.
  }
  return { messageId }
}

/**
 * Procura mensagem pelo CustomID. `found: true` só com pelo menos um resultado.
 * Lista vazia não prova que o envio falhou (a indexação pode atrasar).
 */
export async function findMailjetMessageByCustomId(
  creds: MailjetCredentials,
  customId: string,
): Promise<{ found: boolean; messageId: string | undefined }> {
  const url = new URL(MAILJET_MESSAGE_API)
  url.searchParams.set('CustomID', customId)
  url.searchParams.set('Limit', '1')

  const res = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(MAILJET_TIMEOUT_MS),
    headers: { Authorization: basicAuth(creds) },
  })

  const body = await res.text()
  if (!res.ok) throw new MailjetError(res.status, body)

  try {
    const parsed = JSON.parse(body) as {
      Count?: number
      Data?: Array<{ ID?: number | string }>
    }
    const count = parsed.Count ?? parsed.Data?.length ?? 0
    if (count <= 0) return { found: false, messageId: undefined }
    const id = parsed.Data?.[0]?.ID
    return { found: true, messageId: id !== undefined && id !== null ? String(id) : undefined }
  } catch {
    return { found: false, messageId: undefined }
  }
}

/** Falha em que repetir o envio Mailjet ainda pode ajudar (5xx / rede). */
export function isTransientMailjetError(err: unknown): boolean {
  if (!(err instanceof MailjetError)) return true
  return err.status === 0 || err.status >= 500 || err.status === 429
}
