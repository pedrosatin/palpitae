/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import type { AnalyticsEngineDataset, D1Database } from '@cloudflare/workers-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { RESEND_FETCH_BUDGET, formatTimeBRT, sendRoundReminders } from './roundReminder'

// 07:00 em Brasília de sexta 13/11/2026 e de quarta 18/11/2026.
const FRIDAY = Date.UTC(2026, 10, 13, 10)
const WEDNESDAY = Date.UTC(2026, 10, 18, 10)

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

function createFixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    DELETE FROM competitions;

    INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
      ('ana', 'ana@example.com', 'google', 'g-ana', 'Ana'),
      ('bia', 'bia@example.com', 'google', 'g-bia', 'Bia');

    INSERT INTO competitions (id, name, slug, season, status, type, penalty_phases, visibility) VALUES
      ('bra', 'Brasileirão Série A', 'bra-2026', '2026', 'ongoing', 'league', '[]', 'public'),
      ('cdb', 'Copa do Brasil', 'cdb-2026', '2026', 'ongoing', 'cup', '[]', 'public');

    INSERT INTO teams (id, name, short_name, slug, logo_url) VALUES
      ('fla', 'Flamengo', 'FLA', 'flamengo', 'https://crests.example/fla.png'),
      ('pal', 'Palmeiras', 'PAL', 'palmeiras', NULL),
      ('cor', 'Corinthians', 'COR', 'corinthians', NULL),
      ('sao', 'São Paulo', 'SAO', 'sao-paulo', NULL);

    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code) VALUES
      ('g1', 'Realidade do BR', 'bra', 'ana', 'AAAA-1111'),
      ('g2', 'Firma', 'bra', 'ana', 'BBBB-2222'),
      ('g3', 'Copa da Família', 'cdb', 'ana', 'CCCC-3333');

    INSERT INTO group_members (id, group_id, user_id, role) VALUES
      ('gm1', 'g1', 'ana', 'owner');
  `)
  return { sqlite, db: db as unknown as D1Database }
}

type MatchOptions = {
  id: string
  start: string
  competition?: string
  round?: string
  status?: string
  postponed?: number
  lockedAt?: string | null
  home?: string
  away?: string
}

function addMatch(
  sqlite: DatabaseSync,
  {
    id,
    start,
    competition = 'bra',
    round = '35',
    status = 'scheduled',
    postponed = 0,
    lockedAt = null,
    home = 'fla',
    away = 'pal',
  }: MatchOptions,
) {
  sqlite
    .prepare(
      `INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id,
         start_time, status, round, postponed, locked_at)
       VALUES (?, ?, ?, 'football-data', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, competition, id, home, away, start, status, round, postponed, lockedAt)
}

function addMember(sqlite: DatabaseSync, group: string, user: string) {
  sqlite
    .prepare(`INSERT INTO group_members (id, group_id, user_id, role) VALUES (?, ?, ?, 'member')`)
    .run(`gm-${group}-${user}`, group, user)
}

function addPrediction(sqlite: DatabaseSync, user: string, group: string, match: string) {
  sqlite
    .prepare(
      `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score)
       VALUES (?, ?, ?, ?, 1, 0)`,
    )
    .run(`p-${user}-${group}-${match}`, user, group, match)
}

/** Adiciona `count` usuários ao grupo g1, além da Ana. */
function addMembers(sqlite: DatabaseSync, count: number) {
  for (let i = 1; i <= count; i++) {
    const user = `u${String(i).padStart(2, '0')}`
    sqlite
      .prepare(
        `INSERT INTO users (id, email, provider, provider_id, user_name) VALUES (?, ?, 'google', ?, ?)`,
      )
      .run(user, `${user}@example.com`, `g-${user}`, user)
    addMember(sqlite, 'g1', user)
  }
}

function sentBodies() {
  return vi.mocked(fetch).mock.calls.map(
    (call) =>
      JSON.parse(call[1]!.body as string) as {
        to: string
        subject: string
        html: string
        text: string
        from: string
        headers?: Record<string, string>
      },
  )
}

function fakeAe() {
  const writeDataPoint = vi.fn()
  return { ae: { writeDataPoint } as unknown as AnalyticsEngineDataset, writeDataPoint }
}

function eventsOf(writeDataPoint: ReturnType<typeof vi.fn>, type: string) {
  return writeDataPoint.mock.calls
    .map((call) => call[0] as { blobs: string[]; doubles: number[] })
    .filter((point) => point.blobs[0] === type)
}

function run(db: D1Database, nowMs: number = WEDNESDAY) {
  return sendRoundReminders(db, 'key', undefined, undefined, undefined, nowMs)
}

describe('sendRoundReminders', () => {
  beforeEach(() => {
    // Nenhum teste fala com o Resend. Toda chamada de rede cai neste stub.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    )
  })

  describe('quem recebe e quais jogos entram', () => {
    it('quem palpitou só o jogo de sexta recebe os 9 de quarta e nada na sexta', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'sexta', start: '2026-11-13T22:00:00Z', home: 'cor', away: 'sao' })
      for (let i = 1; i <= 9; i++) {
        addMatch(sqlite, { id: `quarta-${i}`, start: `2026-11-18T22:${String(i + 10)}:00Z` })
      }
      addPrediction(sqlite, 'ana', 'g1', 'sexta')

      await run(db, FRIDAY)
      expect(fetch).not.toHaveBeenCalled()

      await run(db, WEDNESDAY)

      expect(fetch).toHaveBeenCalledTimes(1)
      const [email] = sentBodies()
      expect(email.to).toBe('ana@example.com')
      expect(email.subject).toBe('9 jogos sem palpite hoje. O primeiro fecha às 19:11')
      expect(email.html.match(/fecha \d\d:\d\d/g)).toHaveLength(9)
      expect(email.html).not.toContain('Corinthians')
    })

    it('sem palpite nenhum, o aviso da sexta lista só o jogo da sexta', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'sexta', start: '2026-11-13T22:00:00Z', home: 'cor', away: 'sao' })
      addMatch(sqlite, { id: 'quarta', start: '2026-11-18T22:00:00Z' })

      await run(db, FRIDAY)

      const [email] = sentBodies()
      expect(email.subject).toBe('1 jogo sem palpite hoje. Fecha às 19:00')
      expect(email.html).toContain('Corinthians')
      expect(email.html).not.toContain('Flamengo')
    })

    it('quem palpitou todos os jogos do dia não recebe nada', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMatch(sqlite, { id: 'm2', start: '2026-11-18T23:30:00Z' })
      addPrediction(sqlite, 'ana', 'g1', 'm1')
      addPrediction(sqlite, 'ana', 'g1', 'm2')

      await run(db)

      expect(fetch).not.toHaveBeenCalled()
    })

    it('descadastrado nunca recebe, mesmo com jogo sem palpite', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      sqlite.exec(`UPDATE users SET email_unsubscribed_at = datetime('now') WHERE id = 'ana'`)

      await run(db)

      expect(fetch).not.toHaveBeenCalled()
    })

    it('palpite em outro grupo não conta e o jogo aparece só no grupo que falta', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMember(sqlite, 'g2', 'ana')
      addPrediction(sqlite, 'ana', 'g1', 'm1')

      await run(db)

      const [email] = sentBodies()
      expect(email.html).toContain('Firma')
      expect(email.html).not.toContain('Realidade do BR')
    })

    it('grupo excluído não gera aviso', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      sqlite.exec(`UPDATE groups SET deleted_at = datetime('now') WHERE id = 'g1'`)

      await run(db)

      expect(fetch).not.toHaveBeenCalled()
    })

    it.each([
      ['adiado no próprio dia', { postponed: 1 }],
      ['adiado depois de começar', { postponed: 1, lockedAt: '2026-11-18T09:00:00Z' }],
      ['já visto iniciado pelo sync', { lockedAt: '2026-11-18T09:00:00Z' }],
      ['ao vivo', { status: 'live' }],
      ['encerrado', { status: 'finished' }],
    ])('jogo %s não entra na lista', async (_name, options) => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'fora', start: '2026-11-18T22:00:00Z', ...options })

      await run(db)

      expect(fetch).not.toHaveBeenCalled()
    })

    it('jogo que começou antes do envio não entra na lista', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'madrugada', start: '2026-11-18T04:00:00Z' })

      await run(db)

      expect(fetch).not.toHaveBeenCalled()
    })

    it('o dia segue o horário de Brasília', async () => {
      const { sqlite, db } = createFixture()
      // 23:30 de quarta em Brasília, já quinta em UTC.
      addMatch(sqlite, { id: 'noite', start: '2026-11-19T02:30:00Z' })
      // 00:00 de quinta em Brasília fica para o aviso de quinta.
      addMatch(sqlite, {
        id: 'madrugada',
        start: '2026-11-19T03:00:00Z',
        home: 'cor',
        away: 'sao',
      })

      await run(db)

      const [email] = sentBodies()
      expect(email.subject).toBe('1 jogo sem palpite hoje. Fecha às 23:30')
      expect(email.html).not.toContain('Corinthians')
    })

    it('jogo remarcado de rodada antiga entra no dia novo com o link da rodada dele', async () => {
      const { sqlite, db } = createFixture()
      // Rodada 21 com a maioria encerrada há meses e um jogo remarcado (ADR-019).
      for (let i = 1; i <= 3; i++) {
        addMatch(sqlite, {
          id: `r21-${i}`,
          round: '21',
          start: `2026-08-0${i}T22:00:00Z`,
          status: 'finished',
          lockedAt: `2026-08-0${i}T22:00:00Z`,
        })
      }
      addMatch(sqlite, { id: 'r21-remarcado', round: '21', start: '2026-11-18T20:00:00Z' })
      addMatch(sqlite, { id: 'r35-1', round: '35', start: '2026-11-18T22:00:00Z' })

      await run(db)

      const [email] = sentBodies()
      expect(email.subject).toBe('2 jogos sem palpite hoje. O primeiro fecha às 17:00')
      expect(email.html).toContain('/grupos/g1?rodada=21')
      expect(email.html).toContain('/grupos/g1?rodada=35')
      expect(email.html).toContain('Rodada 21')
      expect(email.html).toContain('Rodada 35')
      expect(email.html.match(/<h3/g)).toHaveLength(1)
    })
  })

  describe('um e-mail por usuário por dia', () => {
    it('junta vários grupos e campeonatos no mesmo e-mail', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'bra-1', start: '2026-11-18T22:00:00Z' })
      addMatch(sqlite, {
        id: 'cdb-1',
        competition: 'cdb',
        round: 'SEMI_FINALS',
        start: '2026-11-18T23:30:00Z',
        home: 'cor',
        away: 'sao',
      })
      addMember(sqlite, 'g2', 'ana')
      addMember(sqlite, 'g3', 'ana')

      await run(db)

      expect(fetch).toHaveBeenCalledTimes(1)
      const [email] = sentBodies()
      // Dois grupos do mesmo campeonato listam o mesmo jogo. O assunto conta jogos.
      expect(email.subject).toBe('2 jogos sem palpite hoje. O primeiro fecha às 19:00')
      for (const name of ['Realidade do BR', 'Firma', 'Copa da Família']) {
        expect(email.html).toContain(name)
        expect(email.text).toContain(name)
      }
      expect(email.html.match(/<h3/g)).toHaveLength(3)
    })

    it('cada usuário recebe o próprio e-mail, sem endereço compartilhado', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMember(sqlite, 'g1', 'bia')

      await run(db)

      expect(sentBodies().map((email) => email.to).sort()).toEqual([
        'ana@example.com',
        'bia@example.com',
      ])
    })

    it('nova execução no mesmo dia não envia de novo, nem com jogo novo', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })

      await run(db)
      addMatch(sqlite, { id: 'm2', start: '2026-11-18T23:00:00Z' })
      await run(db, WEDNESDAY + 3_600_000)

      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('execuções simultâneas enviam um e-mail só', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })

      await Promise.all([run(db), run(db)])

      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('o dia seguinte tem aviso próprio', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMatch(sqlite, { id: 'm2', start: '2026-11-19T22:00:00Z' })

      await run(db)
      await run(db, WEDNESDAY + 86_400_000)

      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('falha de envio libera o usuário para nova execução no mesmo dia', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 422 }))

      await run(db)
      expect(sqlite.prepare('SELECT user_id FROM email_reminder_sends').all()).toEqual([])

      await run(db)

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(sqlite.prepare('SELECT user_id FROM email_reminder_sends').all()).toEqual([
        { user_id: 'ana' },
      ])
    })

    it('apaga os registros com mais de 7 dias e mantém os recentes', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      sqlite.exec(`
        INSERT INTO email_reminder_sends (user_id, reminder_date) VALUES
          ('bia', '2026-11-10'),
          ('bia', '2026-11-11');
      `)

      await run(db)

      const rows = sqlite
        .prepare('SELECT user_id, reminder_date FROM email_reminder_sends ORDER BY reminder_date')
        .all()
      expect(rows).toEqual([
        { user_id: 'bia', reminder_date: '2026-11-11' },
        { user_id: 'ana', reminder_date: '2026-11-18' },
      ])
    })

    it('manda a mesma chave de idempotência em todas as tentativas', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response('', { status: 500, headers: { 'Retry-After': '0' } }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))

      await run(db)

      const keys = vi
        .mocked(fetch)
        .mock.calls.map((call) => (call[1]!.headers as Record<string, string>)['Idempotency-Key'])
      expect(keys).toEqual(['lembrete-diario/ana/2026-11-18', 'lembrete-diario/ana/2026-11-18'])
    })
  })

  describe('limites do Resend', () => {
    const rateLimited = () =>
      new Response('{"name":"rate_limit_exceeded"}', {
        status: 429,
        headers: { 'Retry-After': '0' },
      })

    it('isola uma falha permanente e segue com os demais', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMember(sqlite, 'g1', 'bia')
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response('boom', { status: 422 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))

      await run(db)

      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('repete em 429 respeitando o Retry-After', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      vi.mocked(fetch)
        .mockResolvedValueOnce(rateLimited())
        .mockResolvedValueOnce(new Response(null, { status: 200 }))

      await run(db)

      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('desiste depois de 3 tentativas sob limite por segundo', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      vi.mocked(fetch).mockImplementation(async () => rateLimited())

      await run(db)

      expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('cota esgotada encerra a fila sem repetir e libera quem não recebeu', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMember(sqlite, 'g1', 'bia')
      const { ae, writeDataPoint } = fakeAe()
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('{"name":"daily_quota_exceeded"}', { status: 429 }),
      )

      await sendRoundReminders(db, 'key', ae, undefined, undefined, WEDNESDAY)

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(sqlite.prepare('SELECT * FROM email_reminder_sends').all()).toEqual([])
      const failures = eventsOf(writeDataPoint, 'email_reminder_failed')
      expect(failures.map((event) => event.blobs[3])).toEqual(['quota_exceeded', 'quota_exceeded'])
      expect(eventsOf(writeDataPoint, 'cron_round_reminder')[0].doubles).toEqual([1, 0, 2, 0])
    })

    it('sem chave do Resend não envia nem reserva', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })

      await sendRoundReminders(db, '', undefined, undefined, undefined, WEDNESDAY)

      expect(fetch).not.toHaveBeenCalled()
      expect(sqlite.prepare('SELECT * FROM email_reminder_sends').all()).toEqual([])
    })
  })

  describe('teto de subrequests por execução', () => {
    const TOTAL = RESEND_FETCH_BUDGET + 6

    function recipientsOf(calls: ReturnType<typeof sentBodies>) {
      return calls.map((body) => body.to)
    }

    it('para no teto de fetch, registra o motivo e devolve as reservas', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMembers(sqlite, TOTAL - 1)
      const { ae, writeDataPoint } = fakeAe()

      await sendRoundReminders(db, 'key', ae, undefined, undefined, WEDNESDAY)

      expect(fetch).toHaveBeenCalledTimes(RESEND_FETCH_BUDGET)
      const reserved = sqlite.prepare('SELECT user_id FROM email_reminder_sends').all()
      expect(reserved).toHaveLength(RESEND_FETCH_BUDGET)
      const failures = eventsOf(writeDataPoint, 'email_reminder_failed')
      expect(failures).toHaveLength(6)
      expect(failures.every((event) => event.blobs[3] === 'subrequest_budget')).toBe(true)
      expect(eventsOf(writeDataPoint, 'cron_round_reminder')[0].doubles).toEqual([
        1,
        RESEND_FETCH_BUDGET,
        6,
        RESEND_FETCH_BUDGET,
      ])
    })

    it('conta os reenvios no teto', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMembers(sqlite, 19)
      const { ae, writeDataPoint } = fakeAe()
      vi.mocked(fetch).mockImplementation(
        async () => new Response('', { status: 500, headers: { 'Retry-After': '0' } }),
      )

      await sendRoundReminders(db, 'key', ae, undefined, undefined, WEDNESDAY)

      expect(fetch).toHaveBeenCalledTimes(RESEND_FETCH_BUDGET)
      expect(sqlite.prepare('SELECT * FROM email_reminder_sends').all()).toEqual([])
      const reasons = eventsOf(writeDataPoint, 'email_reminder_failed').map((e) => e.blobs[3])
      expect(reasons).toHaveLength(20)
      expect(reasons.filter((reason) => reason === 'http_500')).toHaveLength(15)
      expect(reasons.filter((reason) => reason === 'subrequest_budget')).toHaveLength(5)
    })

    it('quem ficou sem e-mail recebe na execução seguinte, sem repetir para os demais', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMembers(sqlite, TOTAL - 1)

      await run(db)
      await run(db)

      const recipients = recipientsOf(sentBodies())
      expect(recipients).toHaveLength(TOTAL)
      expect(new Set(recipients).size).toBe(TOTAL)
      expect(sqlite.prepare('SELECT * FROM email_reminder_sends').all()).toHaveLength(TOTAL)
    })

    it('abaixo do teto envia para todos sem evento de falha', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMembers(sqlite, RESEND_FETCH_BUDGET - 1)
      const { ae, writeDataPoint } = fakeAe()

      await sendRoundReminders(db, 'key', ae, undefined, undefined, WEDNESDAY)

      expect(fetch).toHaveBeenCalledTimes(RESEND_FETCH_BUDGET)
      expect(eventsOf(writeDataPoint, 'email_reminder_failed')).toEqual([])
    })
  })

  describe('descadastro durante o lote', () => {
    // Uma pausa entre dois envios maior que UNSUB_RECHECK_MS.
    const PAUSE_MS = 60_000
    let clock = WEDNESDAY

    beforeEach(() => {
      clock = WEDNESDAY
      vi.spyOn(Date, 'now').mockImplementation(() => clock)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    function unsubscribe(sqlite: DatabaseSync, user: string) {
      sqlite
        .prepare(`UPDATE users SET email_unsubscribed_at = datetime('now') WHERE id = ?`)
        .run(user)
    }

    function reserved(sqlite: DatabaseSync) {
      return sqlite
        .prepare('SELECT user_id FROM email_reminder_sends ORDER BY user_id')
        .all()
        .map((row) => (row as { user_id: string }).user_id)
    }

    /** Destinatário de uma chamada ao Resend. */
    function recipientOf(init: RequestInit | undefined): string {
      return (JSON.parse(init!.body as string) as { to: string }).to.split('@')[0]
    }

    it('quem sai entre a consulta e a reserva não é reservado nem recebe', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMember(sqlite, 'g1', 'bia')
      // A Bia descadastra depois da consulta dos pendentes e antes da reserva.
      const batch = db.batch.bind(db)
      const racing = Object.assign(Object.create(db) as D1Database, {
        batch: (statements: Parameters<D1Database['batch']>[0]) => {
          unsubscribe(sqlite, 'bia')
          return batch(statements)
        },
      })

      await run(racing)

      expect(sentBodies().map((email) => email.to)).toEqual(['ana@example.com'])
      expect(reserved(sqlite)).toEqual(['ana'])
    })

    it('pausar o lote, descadastrar e retomar não envia para quem saiu', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMember(sqlite, 'g1', 'bia')
      const { ae, writeDataPoint } = fakeAe()
      let first: string | undefined
      vi.mocked(fetch).mockImplementation(async (_url, init) => {
        if (!first) {
          // O lote para no primeiro envio, o outro usuário descadastra e o lote segue.
          first = recipientOf(init)
          unsubscribe(sqlite, first === 'ana' ? 'bia' : 'ana')
          clock += PAUSE_MS
        }
        return new Response(null, { status: 200 })
      })

      await sendRoundReminders(db, 'key', ae, undefined, undefined, WEDNESDAY)

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(reserved(sqlite)).toEqual([first])
      // Quem saiu não é falha de envio.
      expect(eventsOf(writeDataPoint, 'email_reminder_failed')).toEqual([])
      expect(eventsOf(writeDataPoint, 'cron_round_reminder')[0].doubles).toEqual([1, 1, 0, 1])
    })

    it('descadastro durante a espera do reenvio cancela o reenvio', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      vi.mocked(fetch).mockImplementationOnce(async () => {
        unsubscribe(sqlite, 'ana')
        clock += PAUSE_MS
        return new Response('', { status: 500, headers: { 'Retry-After': '0' } })
      })

      await run(db)

      // O 500 deixa incerto se o Resend aceitou. O reenvio não sai, e a reserva volta.
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(reserved(sqlite)).toEqual([])
    })

    it('descadastro depois do aceite pelo provedor não desfaz o envio', async () => {
      // Limite conhecido: depois que o Resend aceita, o e-mail já saiu. O descadastro
      // vale do próximo envio em diante.
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      const { ae, writeDataPoint } = fakeAe()
      vi.mocked(fetch).mockImplementationOnce(async () => {
        const accepted = new Response(null, { status: 200 })
        unsubscribe(sqlite, 'ana')
        clock += PAUSE_MS
        return accepted
      })

      await sendRoundReminders(db, 'key', ae, undefined, undefined, WEDNESDAY)
      await run(db, WEDNESDAY + 3_600_000)

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(eventsOf(writeDataPoint, 'email_reminder_sent')).toHaveLength(1)
      expect(reserved(sqlite)).toEqual(['ana'])
    })

    it('a revalidação desconta do teto de subrequests', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMembers(sqlite, RESEND_FETCH_BUDGET + 5)
      vi.mocked(fetch).mockImplementationOnce(async () => {
        clock += PAUSE_MS
        return new Response(null, { status: 200 })
      })

      await run(db)

      // Uma consulta de revalidação depois da pausa ocupa o lugar de um envio.
      expect(fetch).toHaveBeenCalledTimes(RESEND_FETCH_BUDGET - 1)
      expect(reserved(sqlite)).toHaveLength(RESEND_FETCH_BUDGET - 1)
    })

    it('falha na revalidação encerra a fila e devolve as reservas', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMember(sqlite, 'g1', 'bia')
      const { ae, writeDataPoint } = fakeAe()
      const prepare = db.prepare.bind(db)
      const flaky = Object.assign(Object.create(db) as D1Database, {
        prepare: (sql: string) => {
          if (sql.trimStart().startsWith('SELECT id FROM users')) throw new Error('D1 indisponível')
          return prepare(sql)
        },
      })
      let first: string | undefined
      vi.mocked(fetch).mockImplementation(async (_url, init) => {
        first ??= recipientOf(init)
        clock += PAUSE_MS
        return new Response(null, { status: 200 })
      })

      await sendRoundReminders(flaky, 'key', ae, undefined, undefined, WEDNESDAY)

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(reserved(sqlite)).toEqual([first])
      const reasons = eventsOf(writeDataPoint, 'email_reminder_failed').map((e) => e.blobs[3])
      expect(reasons).toEqual(['unsub_check_failed'])
    })
  })

  describe('observabilidade', () => {
    it('registra enviados, falhas e jogos listados por envio', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })
      addMatch(sqlite, { id: 'm2', start: '2026-11-18T23:00:00Z', home: 'cor', away: 'sao' })
      addMember(sqlite, 'g2', 'ana')
      addMember(sqlite, 'g1', 'bia')
      addPrediction(sqlite, 'bia', 'g1', 'm1')
      const { ae, writeDataPoint } = fakeAe()
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response('boom', { status: 422 }))

      await sendRoundReminders(db, 'key', ae, undefined, undefined, WEDNESDAY)

      const [sent] = eventsOf(writeDataPoint, 'email_reminder_sent')
      expect(sent.blobs[2]).toBe('2026-11-18')
      expect(sent.doubles).toEqual([2, 2])
      expect(sent.blobs.join()).not.toContain('@')

      const [failed] = eventsOf(writeDataPoint, 'email_reminder_failed')
      expect(failed.blobs.slice(2)).toEqual(['2026-11-18', 'http_422'])
      expect(failed.doubles).toEqual([1])

      expect(eventsOf(writeDataPoint, 'cron_round_reminder')[0].doubles).toEqual([1, 1, 1, 2])
    })

    it('sem jogo pendente registra a execução zerada', async () => {
      const { db } = createFixture()
      const { ae, writeDataPoint } = fakeAe()

      await sendRoundReminders(db, 'key', ae, undefined, undefined, WEDNESDAY)

      expect(eventsOf(writeDataPoint, 'cron_round_reminder')[0].doubles).toEqual([0, 0, 0, 0])
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('conteúdo do e-mail', () => {
    it('autentica na API do Resend com o remetente do Palpitae', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })

      await sendRoundReminders(db, 'secret-key', undefined, undefined, undefined, WEDNESDAY)

      const [url, init] = vi.mocked(fetch).mock.calls[0]
      expect(url).toBe('https://api.resend.com/emails')
      expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
      expect(sentBodies()[0].from).toContain('palpitae.com.br')
    })

    it('mostra o horário de fechamento de cada jogo no HTML e no texto', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })

      await run(db)

      const [email] = sentBodies()
      expect(email.html).toContain('fecha 19:00')
      expect(email.html).toContain('table-layout: fixed')
      expect(email.html).not.toMatch(/<td[^>]*>[^<]*vs[^<]*<\/td>/)
      expect(email.text).toContain('Flamengo vs Palmeiras, fecha 19:00')
      expect(email.text).not.toContain('<')
    })

    it('o link abre o grupo na rodada, com a rodada escapada', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, {
        id: 'm1',
        competition: 'cdb',
        round: 'SEMI FINALS',
        start: '2026-11-18T22:00:00Z',
      })
      sqlite.exec(`UPDATE group_members SET group_id = 'g3' WHERE id = 'gm1'`)

      await sendRoundReminders(db, 'key', undefined, 'http://localhost:5173', undefined, WEDNESDAY)

      const [email] = sentBodies()
      expect(email.html).toContain('http://localhost:5173/grupos/g3?rodada=SEMI%20FINALS')
      expect(email.text).toContain('http://localhost:5173/grupos/g3?rodada=SEMI%20FINALS')
    })

    it('traduz a fase de mata-mata para o rótulo de exibição', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, {
        id: 'm1',
        competition: 'cdb',
        round: 'LAST_32',
        start: '2026-11-18T22:00:00Z',
      })
      sqlite.exec(`UPDATE group_members SET group_id = 'g3' WHERE id = 'gm1'`)

      await run(db)

      const [email] = sentBodies()
      expect(email.html).toContain('Rodada de 32')
      expect(email.text).toContain('Rodada de 32')
      expect(email.html.replace(/rodada=LAST_32/g, '')).not.toContain('LAST_32')
    })

    it('escapa os caracteres de HTML que vêm do banco', async () => {
      const { sqlite, db } = createFixture()
      sqlite.exec(`
        UPDATE groups SET name = 'Grupo <b>"A"' WHERE id = 'g1';
        UPDATE competitions SET name = 'Copa & Cia' WHERE id = 'bra';
        UPDATE teams SET name = 'O''Higgins' WHERE id = 'pal';
      `)
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })

      await run(db)

      const [email] = sentBodies()
      expect(email.html).toContain('Grupo &lt;b&gt;&quot;A&quot;')
      expect(email.html).toContain('Copa &amp; Cia')
      expect(email.html).toContain('O&#39;Higgins')
      expect(email.html).not.toContain('Grupo <b>')
    })

    it('gera um documento HTML completo', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })

      await run(db)

      const [email] = sentBodies()
      expect(email.html).toContain('<!DOCTYPE html>')
      expect(email.html).toContain('<head>')
      expect(email.html).toContain('<body')
    })

    it('mostra o escudo quando há logo e omite o <img> quando não há', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })

      await run(db)

      const [email] = sentBodies()
      expect(email.html.match(/<img[^>]+>/g)).toEqual([
        expect.stringContaining('src="https://crests.example/fla.png"'),
      ])
      expect(email.html).toContain('alt="Flamengo"')
    })

    it('não usa UTM nos links', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })

      await run(db)

      const [email] = sentBodies()
      expect(email.html).not.toContain('utm_')
      expect(email.text).not.toContain('utm_')
    })

    it('inclui link e cabeçalhos de descadastro por usuário', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })

      await sendRoundReminders(
        db,
        'key',
        undefined,
        undefined,
        { secret: 'unsub-secret', apiBaseUrl: 'https://api.palpitae.com.br/' },
        WEDNESDAY,
      )

      const [email] = sentBodies()
      const unsubBase = 'https://api.palpitae.com.br/notifications/unsubscribe?token='
      expect(email.html).toContain('Cancelar inscrição')
      expect(email.html).toContain(unsubBase)
      expect(email.text).toContain(unsubBase)
      expect(email.headers?.['List-Unsubscribe']).toContain(`<${unsubBase}`)
      expect(email.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    })

    it('sem configuração de descadastro, sai sem link e sem cabeçalhos', async () => {
      const { sqlite, db } = createFixture()
      addMatch(sqlite, { id: 'm1', start: '2026-11-18T22:00:00Z' })

      await run(db)

      const [email] = sentBodies()
      expect(email.html).not.toContain('Cancelar inscrição')
      expect(email.headers).toBeUndefined()
    })
  })
})

describe('formatTimeBRT', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(['UTC', 'America/New_York'])('usa Brasília com o processo em %s', (tz) => {
    vi.stubEnv('TZ', tz)
    expect(formatTimeBRT('2026-06-20T22:00:00Z')).toBe('19:00')
  })

  it('volta o dia quando a hora UTC já virou', () => {
    expect(formatTimeBRT('2026-06-21T01:00:00Z')).toBe('22:00')
  })

  it('usa dois dígitos para hora e minuto', () => {
    expect(formatTimeBRT('2026-01-05T06:05:00Z')).toBe('03:05')
  })

  it('lança erro para data inválida', () => {
    expect(() => formatTimeBRT('nao-e-data')).toThrow(RangeError)
  })
})
