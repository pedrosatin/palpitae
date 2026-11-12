/**
 * Token próprio e sem estado para o link de descadastro de um clique nos e-mails.
 *
 * De propósito, não é um JWT: o middleware de autenticação (`requireAuth`) aceita
 * qualquer JWT HS256 assinado com o JWT_SECRET, então reaproveitar o token de
 * sessão aqui transformaria a URL de descadastro, que viaja dentro de todo e-mail,
 * em credencial de sessão. Este token leva só o id do usuário e um HMAC separado:
 * serve para agir sobre o usuário certo e não vale como credencial.
 *
 * Sem expiração: o link de um e-mail antigo precisa continuar funcionando. O HMAC
 * leva um prefixo fixo de domínio, para que um token gerado aqui nunca coincida com
 * outro uso de HMAC do mesmo segredo.
 *
 * Segredos: o token novo é assinado com `UNSUBSCRIBE_SECRET`, que não muda quando o
 * `JWT_SECRET` é rotacionado. Sem ele configurado, a assinatura usa o `JWT_SECRET`,
 * como antes. A verificação aceita os dois, para que links de e-mails enviados antes
 * do segredo próprio continuem valendo. O passo a passo da rotação está em
 * `docs/security.md`.
 */

import { base64UrlDecode, base64UrlEncode } from '../auth/encoding'
import { HMAC_SHA256, importHmacKey } from '../auth/crypto'
import type { Env } from '../types'

const ALGORITHM = HMAC_SHA256
const PREFIX = 'unsub:'
const importKey = importHmacKey

type UnsubSecrets = Pick<Env, 'JWT_SECRET' | 'UNSUBSCRIBE_SECRET'>

/**
 * Segredo que assina os links novos: `UNSUBSCRIBE_SECRET` ou, se ausente ou em
 * branco, `JWT_SECRET`. O valor é usado como foi gravado, sem `trim`, para bater com
 * o `JWT_SECRET` quando o operador reaproveita o mesmo valor.
 */
export function unsubSigningSecret(env: UnsubSecrets): string {
  const own = env.UNSUBSCRIBE_SECRET
  return own?.trim() ? own : env.JWT_SECRET
}

/**
 * Segredos aceitos na verificação, em ordem: o próprio do descadastro e o
 * `JWT_SECRET`, que assinou os links anteriores a ele.
 */
function unsubVerifySecrets(env: UnsubSecrets): string[] {
  return [...new Set([unsubSigningSecret(env), env.JWT_SECRET])]
}

/** Mints `<base64url(userId)>.<base64url(hmac)>` for the unsubscribe link. */
export async function signUnsubToken(userId: string, secret: string): Promise<string> {
  const key = await importKey(secret)
  const message = new TextEncoder().encode(PREFIX + userId)
  const sig = await crypto.subtle.sign(ALGORITHM, key, message)
  const idPart = base64UrlEncode(new TextEncoder().encode(userId).buffer as ArrayBuffer)
  return `${idPart}.${base64UrlEncode(sig)}`
}

/**
 * Verifies a token and returns the user id. Throws on a malformed or tampered
 * token. Uses crypto.subtle.verify for a constant-time signature comparison.
 */
export async function verifyUnsubToken(token: string, secret: string): Promise<string> {
  const parts = token.split('.')
  if (parts.length !== 2) throw new Error('Invalid unsubscribe token format')

  const [idPart, sigPart] = parts as [string, string]
  const userId = new TextDecoder().decode(base64UrlDecode(idPart))

  const key = await importKey(secret)
  const valid = await crypto.subtle.verify(
    ALGORITHM,
    key,
    base64UrlDecode(sigPart),
    new TextEncoder().encode(PREFIX + userId),
  )
  if (!valid) throw new Error('Invalid unsubscribe token signature')

  return userId
}

/**
 * Verifica o token contra cada segredo aceito e devolve o user id. Lança se nenhum
 * confere ou se o token estiver malformado.
 */
export async function verifyUnsubTokenForEnv(token: string, env: UnsubSecrets): Promise<string> {
  let lastError: unknown = new Error('Invalid unsubscribe token signature')
  for (const secret of unsubVerifySecrets(env)) {
    try {
      return await verifyUnsubToken(token, secret)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}
