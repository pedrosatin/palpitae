/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * O deploy da API aplica as migrations antes de publicar o Worker. Se a
 * publicação falhar, o Worker anterior continua no ar com o schema novo. Por
 * isso uma migration só pode remover ou renomear o que o Worker em produção
 * já não usa (fase "contract" de docs/operations/migrations.md), e precisa
 * dizer isso com uma linha `-- contract: <motivo>`.
 */
const MIGRATIONS = new URL('../migrations/', import.meta.url)

const CONTRACT_MARKER = /^[ \t]*--[ \t]*contract:[ \t]*\S/im

const DESTRUCTIVE: { label: string; pattern: RegExp }[] = [
  { label: 'DROP COLUMN', pattern: /\balter\s+table\s+\S+\s+drop\s+(column\s+)?\S+/i },
  {
    label: 'RENAME COLUMN',
    pattern: /\balter\s+table\s+\S+\s+rename\s+(column\s+)?(?!to\b)\S+\s+to\b/i,
  },
  { label: 'RENAME TABLE', pattern: /\balter\s+table\s+\S+\s+rename\s+to\b/i },
  { label: 'DROP TABLE', pattern: /\bdrop\s+table\b/i },
]

/** Tira comentários e literais de texto para não confundir dado com comando. */
function sqlWithoutCommentsAndStrings(sql: string) {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

function uncheckedContractStatements(sql: string): string[] {
  if (CONTRACT_MARKER.test(sql)) return []
  const code = sqlWithoutCommentsAndStrings(sql)
  return DESTRUCTIVE.filter(({ pattern }) => pattern.test(code)).map(({ label }) => label)
}

describe('compatibilidade das migrations com o Worker anterior', () => {
  it('aceita migrations de expand', () => {
    expect(
      uncheckedContractStatements(`
        ALTER TABLE users ADD COLUMN display_name TEXT;
        UPDATE users SET display_name = user_name WHERE display_name IS NULL;
        CREATE INDEX IF NOT EXISTS idx_users_display_name ON users (display_name);
      `),
    ).toEqual([])
  })

  it.each([
    ['ALTER TABLE users DROP COLUMN user_name;', 'DROP COLUMN'],
    ['alter table users drop user_name;', 'DROP COLUMN'],
    ['ALTER TABLE users RENAME COLUMN user_name TO display_name;', 'RENAME COLUMN'],
    ['ALTER TABLE users RENAME user_name TO display_name;', 'RENAME COLUMN'],
    ['ALTER TABLE users RENAME TO accounts;', 'RENAME TABLE'],
    ['DROP TABLE IF EXISTS email_reminder_sends;', 'DROP TABLE'],
  ])('recusa %s sem marcação de contract', (sql, label) => {
    expect(uncheckedContractStatements(sql)).toEqual([label])
  })

  it('aceita a remoção quando a migration se declara contract', () => {
    expect(
      uncheckedContractStatements(`
        -- contract: users.user_name sem leitura desde o deploy que passou a usar display_name
        ALTER TABLE users DROP COLUMN user_name;
      `),
    ).toEqual([])
  })

  it('não confunde comentário nem texto gravado com comando', () => {
    expect(
      uncheckedContractStatements(`
        -- Não use ALTER TABLE users DROP COLUMN aqui.
        /* ALTER TABLE users RENAME COLUMN a TO b */
        UPDATE competitions SET name = 'drop table; alter table x drop column y';
      `),
    ).toEqual([])
  })

  it('não aceita a palavra contract sem motivo', () => {
    expect(
      uncheckedContractStatements('-- contract:\nALTER TABLE users DROP COLUMN user_name;'),
    ).toEqual(['DROP COLUMN'])
  })

  it('nenhuma migration do repositório remove ou renomeia sem marcação de contract', () => {
    const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql'))
    expect(files.length).toBeGreaterThan(0)

    const violations = files.flatMap((file) =>
      uncheckedContractStatements(readFileSync(new URL(file, MIGRATIONS), 'utf8')).map(
        (label) => `${file}: ${label}`,
      ),
    )

    expect(violations).toEqual([])
  })
})
