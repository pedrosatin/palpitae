/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

/**
 * A migration 0047 sobe em produção com dados existentes: as linhas da
 * football-data ficam como estão, as colunas novas entram com padrão e a linha
 * da ESPN aparece uma vez só, mesmo que já exista (migration reaplicada ou
 * linha criada pelo Worker antes do deploy do schema).
 */
const MIGRATIONS = new URL('../../migrations/', import.meta.url)
const files = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort()
const read = (file: string) => readFileSync(new URL(file, MIGRATIONS), 'utf8')

describe('migration 0047 (coordenação da ESPN)', () => {
  const index = files.findIndex((file) => file.startsWith('0047_'))

  it('é a primeira depois de 0046, sem número repetido', () => {
    expect(files[index - 1]).toMatch(/^0046_/)
    const numbers = files.map((file) => file.slice(0, 4))
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('preserva os dados existentes e acrescenta o estado da ESPN', () => {
    const sqlite = new DatabaseSync(':memory:')
    for (const file of files.slice(0, index)) sqlite.exec(read(file))
    sqlite.exec(`
      UPDATE provider_rate_state
         SET window_started_at = 29_000_000, window_calls = 3, blocked_until = 1_800_000_000_000,
             last_remaining = 0, last_reset_at = 1_800_000_000_000
       WHERE provider = 'football-data';
      INSERT INTO provider_work (provider,kind,competition_code,season,round,priority,status,attempts,created_at,updated_at)
        VALUES ('football-data','result','BSA','2026','10',0,'pending',2,1,1)`)

    sqlite.exec(read(files[index]))

    expect(
      sqlite
        .prepare(
          `SELECT provider, window_calls, blocked_until, forbidden_streak, suspended_at, suspended_reason
             FROM provider_rate_state ORDER BY provider`,
        )
        .all(),
    ).toEqual([
      {
        provider: 'espn',
        window_calls: 0,
        blocked_until: 0,
        forbidden_streak: 0,
        suspended_at: null,
        suspended_reason: null,
      },
      {
        provider: 'football-data',
        window_calls: 3,
        blocked_until: 1_800_000_000_000,
        forbidden_streak: 0,
        suspended_at: null,
        suspended_reason: null,
      },
    ])
    expect(sqlite.prepare('SELECT attempts FROM provider_work').get()).toEqual({ attempts: 2 })
    sqlite.close()
  })

  it('aceita a linha da ESPN já existente sem falhar nem duplicar', () => {
    const sqlite = new DatabaseSync(':memory:')
    for (const file of files.slice(0, index)) sqlite.exec(read(file))
    sqlite.exec(
      "INSERT INTO provider_rate_state (provider, credential, window_calls) VALUES ('espn', 'default', 7)",
    )

    expect(() => sqlite.exec(read(files[index]))).not.toThrow()

    expect(
      sqlite.prepare("SELECT window_calls FROM provider_rate_state WHERE provider = 'espn'").all(),
    ).toEqual([{ window_calls: 7 }])
    sqlite.close()
  })
})
