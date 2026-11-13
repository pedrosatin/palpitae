/**
 * Shared base64url encoding/decoding utilities.
 * Compatible with Web Crypto API (Workers + Node.js 18+).
 */

export function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function base64UrlDecode(str: string): ArrayBuffer {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]*$/

/**
 * Decodifica só base64url canônico: alfabeto `[A-Za-z0-9_-]`, sem `=`, e o texto
 * tem de voltar idêntico ao ser codificado de novo. `base64UrlDecode` é
 * tolerante: aceita `=` no fim, `+` e `/`, espaço no meio e bits de sobra no
 * último caractere, então vários textos viram os mesmos bytes. Use esta função
 * quando o texto identifica o valor, como o token de sessão, revogado pelo hash
 * do texto.
 */
export function base64UrlDecodeCanonical(str: string): ArrayBuffer {
  if (!BASE64URL_ALPHABET.test(str)) throw new Error('Non-canonical base64url')
  const buf = base64UrlDecode(str)
  if (base64UrlEncode(buf) !== str) throw new Error('Non-canonical base64url')
  return buf
}
