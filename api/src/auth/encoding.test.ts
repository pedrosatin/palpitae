import { describe, expect, it } from 'vitest'
import { base64UrlDecode, base64UrlEncode } from './encoding'

describe('base64UrlEncode', () => {
  it('produces only URL-safe characters (no +, /, or =)', () => {
    // Use a large buffer to increase the chance of hitting all character types
    const buf = new Uint8Array(64).fill(0).map((_, i) => i * 4).buffer
    const result = base64UrlEncode(buf)
    expect(result).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('encodes an empty buffer to an empty string', () => {
    expect(base64UrlEncode(new Uint8Array(0).buffer)).toBe('')
  })

  it('encodes a known value correctly', () => {
    // "hello" in ASCII -> aGVsbG8 (standard base64url)
    const buf = new TextEncoder().encode('hello').buffer as ArrayBuffer
    expect(base64UrlEncode(buf)).toBe('aGVsbG8')
  })

  it('correctly replaces + with - and removes padding', () => {
    // 251 in base64 is +w==, so in base64url it should be -w
    const buf = new Uint8Array([251]).buffer
    expect(base64UrlEncode(buf)).toBe('-w')
  })

  it('correctly replaces / with _ and removes padding', () => {
    // 255, 255 in base64 is //8=, so in base64url it should be __8
    const buf = new Uint8Array([255, 255]).buffer
    expect(base64UrlEncode(buf)).toBe('__8')
  })

  it('encodes RFC 4648 test vectors correctly', () => {
    const vectors = [
      ['', ''],
      ['f', 'Zg'],
      ['fo', 'Zm8'],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg'],
      ['fooba', 'Zm9vYmE'],
      ['foobar', 'Zm9vYmFy'],
    ]

    for (const [input, expected] of vectors) {
      const buf = new TextEncoder().encode(input).buffer as ArrayBuffer
      expect(base64UrlEncode(buf)).toBe(expected)
    }
  })
})

describe('base64UrlDecode', () => {
  it('decodes an empty string to an empty buffer', () => {
    const result = base64UrlDecode('')
    expect(new Uint8Array(result)).toHaveLength(0)
  })

  it('decodes a known value correctly', () => {
    const result = new TextDecoder().decode(base64UrlDecode('aGVsbG8'))
    expect(result).toBe('hello')
  })

  it('handles strings without padding', () => {
    const original = 'test-data'
    const encoded = base64UrlEncode(new TextEncoder().encode(original).buffer as ArrayBuffer)
    expect(encoded).not.toContain('=')
    const decoded = new TextDecoder().decode(base64UrlDecode(encoded))
    expect(decoded).toBe(original)
  })

  it('throws an error when decoding malformed strings', () => {
    expect(() => base64UrlDecode('a===')).toThrow()
    expect(() => base64UrlDecode('a')).toThrow()
  })

  it('correctly maps URL-safe characters (- and _) to standard base64 characters', () => {
    // btoa(String.fromCharCode(251, 239, 191)) is '+++/'
    // base64Url encoding maps this to '---_'
    const decoded = base64UrlDecode('---_')
    const bytes = new Uint8Array(decoded)
    expect(bytes).toHaveLength(3)
    expect(bytes[0]).toBe(251)
    expect(bytes[1]).toBe(239)
    expect(bytes[2]).toBe(191)
  })

  it('throws an error when decoding an invalid base64url string', () => {
    expect(() => base64UrlDecode('invalid characters !!$$')).toThrowError()
  })
})

describe('base64UrlEncode / base64UrlDecode roundtrip', () => {
  it('encodes and decodes arbitrary binary data', () => {
    const original = new Uint8Array([0, 1, 127, 128, 255, 42, 99])
    const encoded = base64UrlEncode(original.buffer)
    const decoded = new Uint8Array(base64UrlDecode(encoded))
    expect(decoded).toEqual(original)
  })

  it('roundtrips a text string', () => {
    const original = 'Hello, Palpitae! 🎯'
    const buf = new TextEncoder().encode(original).buffer as ArrayBuffer
    const decoded = new TextDecoder().decode(base64UrlDecode(base64UrlEncode(buf)))
    expect(decoded).toBe(original)
  })
})
