/// <reference types="node" />
/// <reference types="vite/client" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import guidesSource from '../../../web/build/guides.ts?raw'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  countSignupsInD1,
  GUIDE_SLUGS,
  parseSignupOrigin,
  summarizeSignupOrigins,
} from './signupOrigin'

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

describe('parseSignupOrigin', () => {
  it.each(['convite', 'busca', 'direto'] as const)('aceita a categoria %s', (category) => {
    expect(parseSignupOrigin(category)).toEqual({ category, guideSlug: '' })
  })

  it.each([
    ['guia_planilha-de-bolao', 'planilha-de-bolao'],
    ['guia_planilha-de-bolao_header', 'planilha-de-bolao'],
  ])('aceita o guia publicado em %s', (token, guideSlug) => {
    expect(parseSignupOrigin(token)).toEqual({ category: 'guia', guideSlug })
  })

  it('aceita o índice dos guias sem slug', () => {
    expect(parseSignupOrigin('guias_header')).toEqual({ category: 'guia', guideSlug: '' })
  })

  it.each([
    'guia_nao-existe',
    'guia_Planilha-de-bolao',
    'guia_planilha-de-bolao_rodape',
    'guia_',
    'desconhecida',
    'CONVITE',
    'https://www.google.com/search?q=bolao',
    'joao@example.com',
    '',
    undefined,
    null,
    42,
    ['convite'],
  ])('transforma %j em desconhecida', (raw) => {
    expect(parseSignupOrigin(raw)).toEqual({ category: 'desconhecida', guideSlug: '' })
  })
})

describe('lista de guias', () => {
  it('é a mesma publicada em web/build/guides.ts', () => {
    const published = [...guidesSource.matchAll(/^\s*slug: '([^']+)',$/gm)].map((match) => match[1])
    expect(published.length).toBeGreaterThan(0)
    expect(new Set(published)).toEqual(GUIDE_SLUGS)
  })
})

describe('summarizeSignupOrigins', () => {
  it('soma por categoria e por guia com o peso do sampling', () => {
    expect(
      summarizeSignupOrigins([
        { origin: 'convite', guide_slug: '', signups: '3' },
        { origin: 'guia', guide_slug: 'planilha-de-bolao', signups: 2 },
        { origin: 'guia', guide_slug: 'bolao-de-empresa', signups: 5 },
        { origin: 'guia', guide_slug: '', signups: 1 },
        { origin: 'busca', guide_slug: '', signups: 4 },
        { origin: 'direto', guide_slug: '', signups: 6 },
        { origin: 'desconhecida', guide_slug: '', signups: 1 },
      ]),
    ).toEqual({
      origins: { convite: 3, guia: 8, busca: 4, direto: 6, desconhecida: 1 },
      guides: [
        { slug: 'bolao-de-empresa', signups: 5 },
        { slug: 'planilha-de-bolao', signups: 2 },
        { slug: '', signups: 1 },
      ],
      totalEvents: 22,
    })
  })

  it('não deixa texto de blob chegar ao payload', () => {
    const summary = summarizeSignupOrigins([
      { origin: 'site-qualquer', guide_slug: 'joao@example.com', signups: 2 },
      { origin: 'guia', guide_slug: 'joao@example.com', signups: 3 },
    ])
    expect(summary.origins.desconhecida).toBe(2)
    expect(summary.guides).toEqual([{ slug: '', signups: 3 }])
    expect(JSON.stringify(summary)).not.toContain('joao')
  })

  it('ignora contagem inválida', () => {
    expect(summarizeSignupOrigins([{ origin: 'busca', signups: 'x' }]).totalEvents).toBe(0)
  })
})

describe('countSignupsInD1', () => {
  it('compara a janela em tempo real, inclusive no formato ISO gravado pelo login', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    sqlite.exec(`
      INSERT INTO users (id,email,provider,provider_id,created_at) VALUES
        ('dentro-iso','a@example.com','google','1',strftime('%Y-%m-%dT%H:%M:%fZ','now','-29 days')),
        ('dentro-sql','b@example.com','google','2',datetime('now','-1 days')),
        ('fora-iso','c@example.com','google','3',strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days','-1 minutes')),
        ('fora-sql','d@example.com','google','4',datetime('now','-40 days'));
    `)

    expect(await countSignupsInD1(db, 30)).toBe(2)
  })
})
