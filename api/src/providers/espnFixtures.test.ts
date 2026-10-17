import { describe, expect, it } from 'vitest'
import copaJson from './__fixtures__/espn-bra-copa-do-brazil-scoreboard.json'
import libertadoresJson from './__fixtures__/espn-conmebol-libertadores-scoreboard.json'
import sudamericanaJson from './__fixtures__/espn-conmebol-sudamericana-scoreboard.json'

/**
 * Contrato das amostras do spike ESPN (docs/architecture/spike-espn-novos-campeonatos.md).
 *
 * As fixtures são recortes de respostas reais de
 * `GET site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard?dates=YYYYMMDD`
 * coletadas em 2026-10-17, com campos pesados removidos (details, odds, broadcasts,
 * links, statistics). Cada fixture junta eventos de mais de um dia na mesma estrutura
 * de scoreboard. Estes testes fixam os campos que o relatório usa para aprovar os
 * slugs como fonte de confrontos: data, times, placar, fase, pênaltis, ida/volta e
 * agregado. Campo que a ESPN não entrega falha aqui em vez de virar suposição.
 */

type FixtureCompetitor = {
  homeAway?: string
  winner?: boolean
  score?: string
  aggregateScore?: number
  shootoutScore?: number
  team?: { id?: string; displayName?: string }
}

type FixtureSeriesCompetitor = { id?: string; winner?: boolean; aggregateScore?: number }

type FixtureCompetition = {
  status?: { type?: { name?: string; state?: string; detail?: string } }
  altGameNote?: string
  notes?: { text?: string }[]
  leg?: { value?: number; displayValue?: string } | null
  series?: {
    title?: string
    totalCompetitions?: number
    completed?: boolean
    competitors?: FixtureSeriesCompetitor[]
  } | null
  group?: { groupId?: string; name?: string } | null
  competitors?: FixtureCompetitor[]
}

type FixtureEvent = {
  id?: string
  date?: string
  name?: string
  season?: { year?: number; slug?: string }
  competitions?: FixtureCompetition[]
}

type FixtureBoard = {
  leagues?: {
    slug?: string
    season?: { year?: number }
    calendar?: { entries?: { label?: string }[] }[]
  }[]
  events?: FixtureEvent[]
}

const BOARDS: { slug: string; board: FixtureBoard }[] = [
  { slug: 'conmebol.libertadores', board: libertadoresJson as unknown as FixtureBoard },
  { slug: 'conmebol.sudamericana', board: sudamericanaJson as unknown as FixtureBoard },
  { slug: 'bra.copa_do_brazil', board: copaJson as unknown as FixtureBoard },
]

function comp(event: FixtureEvent): FixtureCompetition {
  const competition = event.competitions?.[0]
  if (!competition) throw new Error(`evento ${event.id} sem competitions[0]`)
  return competition
}

function teamIds(event: FixtureEvent): string[] {
  return (comp(event).competitors ?? []).map((c) => c.team?.id ?? '')
}

function finished(events: FixtureEvent[]): FixtureEvent[] {
  return events.filter((e) => comp(e).status?.type?.state === 'post')
}

function shootouts(events: FixtureEvent[]): FixtureEvent[] {
  return events.filter((e) => comp(e).status?.type?.name === 'STATUS_FINAL_PEN')
}

/** Par ida/volta: mesmo par de times, fases iguais, mandos invertidos. */
function tiePair(events: FixtureEvent[], phaseSlug: string): [FixtureEvent, FixtureEvent] {
  const legs = events.filter((e) => e.season?.slug === phaseSlug && comp(e).leg)
  const leg1 = legs.find((e) => comp(e).leg?.value === 1)
  const leg2 = legs.find(
    (e) =>
      comp(e).leg?.value === 2 &&
      leg1 &&
      teamIds(e).slice().sort().join(',') === teamIds(leg1).slice().sort().join(','),
  )
  if (!leg1 || !leg2) throw new Error(`par ida/volta não encontrado para ${phaseSlug}`)
  return [leg1, leg2]
}

describe.each(BOARDS)('fixture ESPN $slug', ({ slug, board }) => {
  it('traz a liga da temporada 2026 com o calendário de fases', () => {
    const league = board.leagues?.[0]
    expect(league?.slug).toBe(slug)
    expect(league?.season?.year).toBe(2026)
    const labels = league?.calendar?.[0]?.entries?.map((entry) => entry.label) ?? []
    expect(labels.length).toBeGreaterThanOrEqual(7)
  })

  it('todo evento tem data, fase, mandante e visitante com placar numérico ao encerrar', () => {
    expect(board.events?.length).toBeGreaterThanOrEqual(5)
    for (const event of board.events ?? []) {
      expect(event.id).toBeTruthy()
      expect(Number.isFinite(Date.parse(event.date ?? ''))).toBe(true)
      expect(event.season?.year).toBe(2026)
      expect(event.season?.slug).toBeTruthy()
      expect(comp(event).altGameNote).toBeTruthy()

      const competitors = comp(event).competitors ?? []
      expect(competitors).toHaveLength(2)
      expect(competitors.map((c) => c.homeAway).sort()).toEqual(['away', 'home'])
      for (const competitor of competitors) {
        expect(competitor.team?.id).toBeTruthy()
        expect(competitor.team?.displayName).toBeTruthy()
      }
    }
    for (const event of finished(board.events ?? [])) {
      for (const competitor of comp(event).competitors ?? []) {
        expect(Number.isFinite(Number(competitor.score))).toBe(true)
      }
      expect(['FT', 'FT-Pens']).toContain(comp(event).status?.type?.detail)
    }
  })

  it('jogo de grupo identifica o grupo e não tem leg nem series', () => {
    const groupEvents = (board.events ?? []).filter((e) => e.season?.slug === 'group-stage')
    if (slug === 'bra.copa_do_brazil') {
      // A Copa do Brasil não tem fase de grupos; o calendário dela é só mata-mata.
      expect(groupEvents).toHaveLength(0)
      return
    }
    expect(groupEvents.length).toBeGreaterThanOrEqual(1)
    for (const event of groupEvents) {
      expect(comp(event).group?.name).toMatch(/^Group [A-H]$/)
      expect(comp(event).leg ?? null).toBeNull()
      expect(comp(event).series ?? null).toBeNull()
    }
  })

  it('confronto de ida e volta liga as pernas por leg e series, com agregado na volta', () => {
    const phases = [...new Set((board.events ?? []).map((e) => e.season?.slug ?? ''))]
    const tiedPhase = phases.find((phase) => {
      try {
        tiePair(board.events ?? [], phase)
        return true
      } catch {
        return false
      }
    })
    expect(tiedPhase).toBeTruthy()
    const [leg1, leg2] = tiePair(board.events ?? [], tiedPhase ?? '')

    expect(comp(leg1).leg).toEqual({ value: 1, displayValue: '1st Leg' })
    expect(comp(leg2).leg).toEqual({ value: 2, displayValue: '2nd Leg' })
    expect(comp(leg1).series?.totalCompetitions).toBe(2)
    expect(comp(leg2).series?.totalCompetitions).toBe(2)
    expect(comp(leg1).series?.title).toBe(comp(leg2).series?.title)
    expect(comp(leg1).series?.completed).toBe(false)
    expect(comp(leg2).series?.completed).toBe(true)

    // O mando inverte entre a ida e a volta.
    const leg1Home = comp(leg1).competitors?.find((c) => c.homeAway === 'home')?.team?.id
    const leg2Away = comp(leg2).competitors?.find((c) => c.homeAway === 'away')?.team?.id
    expect(leg1Home).toBe(leg2Away)

    // Agregado estruturado na volta, igual em competitors e em series.competitors.
    const seriesByTeam = new Map(
      (comp(leg2).series?.competitors ?? []).map((c) => [c.id, c.aggregateScore]),
    )
    for (const competitor of comp(leg2).competitors ?? []) {
      expect(typeof competitor.aggregateScore).toBe('number')
      expect(seriesByTeam.get(competitor.team?.id ?? '')).toBe(competitor.aggregateScore)
    }
    const classified = (comp(leg2).series?.competitors ?? []).filter((c) => c.winner)
    expect(classified).toHaveLength(1)
  })

  it('jogo decidido nos pênaltis expõe shootoutScore e o vencedor da disputa', () => {
    const decided = shootouts(board.events ?? [])
    expect(decided.length).toBeGreaterThanOrEqual(1)
    for (const event of decided) {
      expect(comp(event).status?.type?.detail).toBe('FT-Pens')
      const competitors = comp(event).competitors ?? []
      for (const competitor of competitors) {
        expect(typeof competitor.shootoutScore).toBe('number')
      }
      const winner = competitors.find((c) => c.winner)
      const loser = competitors.find((c) => !c.winner)
      expect(winner).toBeTruthy()
      expect((winner?.shootoutScore ?? 0) > (loser?.shootoutScore ?? 0)).toBe(true)
      // Havendo series, o classificado da series é o vencedor dos pênaltis.
      const series = comp(event).series
      if (series) {
        expect(series.competitors?.find((c) => c.winner)?.id).toBe(winner?.team?.id)
      }
    }
  })
})

describe('amostras decisivas do spike', () => {
  it('Libertadores: Palmeiras se classifica perdendo o jogo da volta para a Liga de Quito', () => {
    // Volta das quartas em 2026-09-16: Liga de Quito 3 x 2 Palmeiras no jogo,
    // agregado 3 x 3 e Palmeiras vencedor dos pênaltis por 4 x 3. O vencedor do
    // jogo e o classificado são times diferentes; só shootoutScore e winner
    // separam os dois papéis.
    const event = (libertadoresJson as unknown as FixtureBoard).events?.find(
      (e) => e.id === '401912525',
    )
    expect(event).toBeTruthy()
    const competitors = comp(event as FixtureEvent).competitors ?? []
    const matchWinner = competitors.reduce((a, b) => (Number(a.score) >= Number(b.score) ? a : b))
    const classified = competitors.find((c) => c.winner)
    expect(matchWinner.team?.displayName).toBe('Liga de Quito')
    expect(classified?.team?.displayName).toBe('Palmeiras')
    expect(classified?.shootoutScore).toBe(4)
  })

  it('Sul-Americana: a volta das quartas entre Atlético-MG e Santos fecha o confronto nos pênaltis', () => {
    const [leg1, leg2] = tiePair(
      (sudamericanaJson as unknown as FixtureBoard).events ?? [],
      'quarterfinals',
    )
    expect(leg1.date?.slice(0, 10)).toBe('2026-09-09')
    expect(leg2.date?.slice(0, 10)).toBe('2026-09-16')
    expect(comp(leg2).status?.type?.name).toBe('STATUS_FINAL_PEN')
    const classified = (comp(leg2).series?.competitors ?? []).find((c) => c.winner)
    expect(classified?.aggregateScore).toBe(4)
  })

  it('Copa do Brasil: as rodadas iniciais são jogo único e decidem nos pênaltis sem leg nem series', () => {
    const board = copaJson as unknown as FixtureBoard
    const singleLeg = (board.events ?? []).filter((e) =>
      ['first-round', 'third-round'].includes(e.season?.slug ?? ''),
    )
    expect(singleLeg.length).toBeGreaterThanOrEqual(2)
    for (const event of singleLeg) {
      expect(comp(event).leg ?? null).toBeNull()
      expect(comp(event).series ?? null).toBeNull()
      expect(comp(event).status?.type?.name).toBe('STATUS_FINAL_PEN')
    }
    // Da quinta rodada em diante o confronto passa a ter ida e volta.
    const fifthRound = (board.events ?? []).find((e) => e.season?.slug === 'fifth-round')
    expect(comp(fifthRound as FixtureEvent).leg?.value).toBe(1)
    expect(comp(fifthRound as FixtureEvent).series?.totalCompetitions).toBe(2)
  })

  it('Copa do Brasil: a semifinal futura já vem como pre com leg e series montados', () => {
    const board = copaJson as unknown as FixtureBoard
    const upcoming = (board.events ?? []).find((e) => comp(e).status?.type?.state === 'pre')
    expect(upcoming).toBeTruthy()
    expect(upcoming?.season?.slug).toBe('semifinals')
    expect(comp(upcoming as FixtureEvent).leg?.value).toBe(1)
    expect(comp(upcoming as FixtureEvent).series?.completed).toBe(false)
  })

  it('as fases amostradas cobrem o calendário de cada competição', () => {
    const phases = (board: FixtureBoard) => new Set((board.events ?? []).map((e) => e.season?.slug))
    expect(phases(libertadoresJson as unknown as FixtureBoard)).toEqual(
      new Set(['first-stage', 'group-stage', 'round-of-16', 'quarterfinals', 'semifinals']),
    )
    expect(phases(sudamericanaJson as unknown as FixtureBoard)).toEqual(
      new Set([
        'first-stage',
        'group-stage',
        'knockout-round-playoffs',
        'round-of-16',
        'quarterfinals',
      ]),
    )
    expect(phases(copaJson as unknown as FixtureBoard)).toEqual(
      new Set(['first-round', 'third-round', 'fifth-round', 'round-of-16', 'semifinals']),
    )
  })
})
