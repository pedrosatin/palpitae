import { describe, expect, it } from 'vitest'
import serieBJson from './__fixtures__/espn-bra-2-scoreboard.json'
import paulistaJson from './__fixtures__/espn-bra-camp-paulista-scoreboard.json'
import cariocaJson from './__fixtures__/espn-bra-camp-carioca-scoreboard.json'
import mineiroJson from './__fixtures__/espn-bra-camp-mineiro-scoreboard.json'
import gauchoJson from './__fixtures__/espn-bra-camp-gaucho-scoreboard.json'
import copaJson from './__fixtures__/espn-bra-copa-do-brazil-scoreboard.json'
import libertadoresJson from './__fixtures__/espn-conmebol-libertadores-scoreboard.json'
import sudamericanaJson from './__fixtures__/espn-conmebol-sudamericana-scoreboard.json'

/**
 * Contrato das amostras do spike ESPN.
 *
 * Copas: docs/architecture/spike-espn-novos-campeonatos.md (coleta 2026-10-17).
 * Série B: docs/architecture/spike-espn-serie-b.md (coleta 2026-10-19).
 * Paulista: docs/architecture/spike-espn-paulista.md (coleta 2026-10-24).
 * Carioca: docs/architecture/spike-espn-carioca.md (coleta 2026-10-24).
 * Mineiro: docs/architecture/spike-espn-mineiro.md (coleta 2026-10-24).
 * Gaúcho: docs/architecture/spike-espn-gaucho.md (coleta 2026-10-24).
 *
 * As fixtures são recortes de respostas reais de
 * `GET site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard?dates=YYYYMMDD`,
 * com campos pesados removidos (details, odds, broadcasts, links, statistics).
 * Cada fixture junta eventos de mais de um dia na mesma estrutura de scoreboard.
 * Estes testes fixam os campos que o relatório usa para aprovar os slugs como
 * fonte de confrontos. Campo que a ESPN não entrega falha aqui em vez de virar
 * suposição.
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
  /** Ausente no scoreboard ao vivo de bra.2. O contrato da liga fixa isso. */
  week?: number | { number?: number }
  matchday?: number
  competitions?: FixtureCompetition[]
}

type FixtureBoard = {
  leagues?: {
    slug?: string
    season?: { year?: number }
    /** Copas: entradas de fase. Ligas: lista plana de datas ISO. */
    calendar?: ({ entries?: { label?: string }[] } | string)[]
  }[]
  events?: FixtureEvent[]
}

type Slug = 'conmebol.libertadores' | 'conmebol.sudamericana' | 'bra.copa_do_brazil'

const FIXTURES = {
  'conmebol.libertadores': libertadoresJson,
  'conmebol.sudamericana': sudamericanaJson,
  'bra.copa_do_brazil': copaJson,
} as unknown as Record<Slug, FixtureBoard>

const SERIE_B = serieBJson as unknown as FixtureBoard
const PAULISTA = paulistaJson as unknown as FixtureBoard
const CARIOCA = cariocaJson as unknown as FixtureBoard
const MINEIRO = mineiroJson as unknown as FixtureBoard

/** Fases por competição em `leagues[0].calendar[0].entries`, como o relatório descreve. */
const CALENDAR_SIZE: Record<Slug, number> = {
  'conmebol.libertadores': 8,
  'conmebol.sudamericana': 7,
  'bra.copa_do_brazil': 9,
}

const BOARDS = (Object.keys(FIXTURES) as Slug[]).map((slug) => ({ slug, board: FIXTURES[slug] }))

/** Team id da ESPN para o Atlético-MG, conferido na fixture da Sul-Americana. */
const ATLETICO_MG_ID = '7632'

function comp(event: FixtureEvent): FixtureCompetition {
  const competition = event.competitions?.[0]
  if (!competition) throw new Error(`evento ${event.id} sem competitions[0]`)
  return competition
}

function finished(events: FixtureEvent[]): FixtureEvent[] {
  return events.filter((e) => comp(e).status?.type?.state === 'post')
}

function shootouts(events: FixtureEvent[]): FixtureEvent[] {
  return events.filter((e) => comp(e).status?.type?.name === 'STATUS_FINAL_PEN')
}

function teamIdBySide(event: FixtureEvent, side: 'home' | 'away'): string | undefined {
  return comp(event).competitors?.find((c) => c.homeAway === side)?.team?.id
}

/**
 * Par ida/volta da fase: procura, entre todas as idas, uma que tenha a volta na
 * fixture com o mando invertido (o mandante da ida é o visitante da volta).
 */
function findTiePair(
  events: FixtureEvent[],
  phaseSlug: string,
): [FixtureEvent, FixtureEvent] | undefined {
  const legs = events.filter((e) => e.season?.slug === phaseSlug)
  for (const leg1 of legs.filter((e) => comp(e).leg?.value === 1)) {
    const leg2 = legs.find(
      (e) =>
        comp(e).leg?.value === 2 &&
        teamIdBySide(e, 'away') === teamIdBySide(leg1, 'home') &&
        teamIdBySide(e, 'home') === teamIdBySide(leg1, 'away'),
    )
    if (leg2) return [leg1, leg2]
  }
  return undefined
}

function tiePair(events: FixtureEvent[], phaseSlug: string): [FixtureEvent, FixtureEvent] {
  const pair = findTiePair(events, phaseSlug)
  if (!pair) throw new Error(`par ida/volta não encontrado para ${phaseSlug}`)
  return pair
}

/** "Round of 16" vira "round-of-16", no formato de `season.slug`. */
function slugify(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, '-')
}

describe.each(BOARDS)('fixture ESPN $slug', ({ slug, board }) => {
  it('traz a liga da temporada 2026 com o calendário de fases', () => {
    const league = board.leagues?.[0]
    expect(league?.slug).toBe(slug)
    expect(league?.season?.year).toBe(2026)
    const first = league?.calendar?.[0]
    expect(first && typeof first === 'object' && 'entries' in first).toBe(true)
    const labels =
      first && typeof first === 'object' && 'entries' in first
        ? (first.entries?.map((entry) => entry.label) ?? [])
        : []
    expect(labels).toHaveLength(CALENDAR_SIZE[slug])
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
        expect(competitor.team?.id).toMatch(/^\d+$/)
        expect(competitor.team?.displayName).toBeTruthy()
      }
    }
    for (const event of finished(board.events ?? [])) {
      for (const competitor of comp(event).competitors ?? []) {
        expect(competitor.score).toMatch(/^\d+$/)
      }
      expect(['STATUS_FULL_TIME', 'STATUS_FINAL_PEN']).toContain(comp(event).status?.type?.name)
      expect(['FT', 'FT-Pens']).toContain(comp(event).status?.type?.detail)
    }
  })

  it('altGameNote repete o grupo no jogo de grupo e a fase no mata-mata', () => {
    for (const event of board.events ?? []) {
      const note = comp(event).altGameNote ?? ''
      const phase = note.split(',').at(-1) ?? ''
      if (event.season?.slug === 'group-stage') {
        expect(phase.trim()).toBe(comp(event).group?.name)
      } else {
        expect(slugify(phase)).toBe(event.season?.slug)
      }
    }
  })

  it('jogo agendado traz placar "0" nos dois competidores', () => {
    const scheduled = (board.events ?? []).filter((e) => comp(e).status?.type?.state === 'pre')
    // Só a fixture da Copa do Brasil guarda um jogo futuro, a semifinal de 1 de novembro.
    expect(scheduled).toHaveLength(slug === 'bra.copa_do_brazil' ? 1 : 0)
    for (const event of scheduled) {
      for (const competitor of comp(event).competitors ?? []) {
        expect(competitor.score).toBe('0')
      }
    }
  })

  it('jogo de mata-mata não tem group', () => {
    const knockout = (board.events ?? []).filter((e) => e.season?.slug !== 'group-stage')
    expect(knockout.length).toBeGreaterThanOrEqual(1)
    for (const event of knockout) {
      expect(comp(event).group ?? null).toBeNull()
    }
  })

  it('ida não traz aggregateScore em competitors nem em series', () => {
    const firstLegs = (board.events ?? []).filter((e) => comp(e).leg?.value === 1)
    expect(firstLegs.length).toBeGreaterThanOrEqual(1)
    for (const event of firstLegs) {
      for (const competitor of comp(event).competitors ?? []) {
        expect(competitor.aggregateScore).toBeUndefined()
      }
      for (const competitor of comp(event).series?.competitors ?? []) {
        expect(competitor.aggregateScore).toBeUndefined()
      }
      expect(comp(event).series?.completed).toBe(false)
    }
  })

  it('jogo encerrado sem pênaltis não traz shootoutScore', () => {
    const regular = finished(board.events ?? []).filter(
      (e) => comp(e).status?.type?.name === 'STATUS_FULL_TIME',
    )
    expect(regular.length).toBeGreaterThanOrEqual(1)
    for (const event of regular) {
      for (const competitor of comp(event).competitors ?? []) {
        expect(competitor.shootoutScore).toBeUndefined()
      }
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
    const tiedPhase = phases.find((phase) => findTiePair(board.events ?? [], phase))
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
    expect(teamIdBySide(leg2, 'away')).toBe(teamIdBySide(leg1, 'home'))
    expect(teamIdBySide(leg2, 'home')).toBe(teamIdBySide(leg1, 'away'))

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
    const event = FIXTURES['conmebol.libertadores'].events?.find(
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
    const [leg1, leg2] = tiePair(FIXTURES['conmebol.sudamericana'].events ?? [], 'quarterfinals')
    expect(leg1.date?.slice(0, 10)).toBe('2026-09-09')
    expect(leg2.date?.slice(0, 10)).toBe('2026-09-16')
    expect(comp(leg2).status?.type?.name).toBe('STATUS_FINAL_PEN')

    const classified = (comp(leg2).series?.competitors ?? []).filter((c) => c.winner)
    expect(classified.map((c) => c.id)).toEqual([ATLETICO_MG_ID])

    const competitors = comp(leg2).competitors ?? []
    const atletico = competitors.find((c) => c.team?.id === ATLETICO_MG_ID)
    const santos = competitors.find((c) => c.team?.id !== ATLETICO_MG_ID)
    expect(atletico?.team?.displayName).toBe('Atlético-MG')
    expect(santos?.team?.displayName).toBe('Santos')
    expect(atletico?.shootoutScore).toBe(3)
    expect(santos?.shootoutScore).toBe(1)
    expect(atletico?.winner).toBe(true)
    expect(santos?.winner).toBe(false)
  })

  it('Copa do Brasil: as rodadas iniciais são jogo único e decidem nos pênaltis sem leg nem series', () => {
    const board = FIXTURES['bra.copa_do_brazil']
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
    const board = FIXTURES['bra.copa_do_brazil']
    const upcoming = (board.events ?? []).find((e) => comp(e).status?.type?.state === 'pre')
    expect(upcoming).toBeTruthy()
    expect(upcoming?.season?.slug).toBe('semifinals')
    expect(comp(upcoming as FixtureEvent).leg?.value).toBe(1)
    expect(comp(upcoming as FixtureEvent).series?.completed).toBe(false)
  })

  it('as fixtures guardam estas fases por competição', () => {
    const phases = (board: FixtureBoard) => new Set((board.events ?? []).map((e) => e.season?.slug))
    expect(phases(FIXTURES['conmebol.libertadores'])).toEqual(
      new Set(['first-stage', 'group-stage', 'round-of-16', 'quarterfinals', 'semifinals']),
    )
    expect(phases(FIXTURES['conmebol.sudamericana'])).toEqual(
      new Set([
        'first-stage',
        'group-stage',
        'knockout-round-playoffs',
        'round-of-16',
        'quarterfinals',
      ]),
    )
    expect(phases(FIXTURES['bra.copa_do_brazil'])).toEqual(
      new Set(['first-round', 'third-round', 'fifth-round', 'round-of-16', 'semifinals']),
    )
  })
})

/**
 * Contrato da Série B (liga). Separado do bloco de copas: calendário plano de
 * datas, season.slug no padrão YYYY-…, sem leg/series e sem week/matchday no
 * scoreboard ao vivo. O mapeamento REGULAR_SEASON já está em espnSync (#546).
 */
describe('fixture ESPN bra.2', () => {
  const board = SERIE_B
  const events = board.events ?? []

  function isTbdEvent(event: FixtureEvent): boolean {
    const competitors = comp(event).competitors ?? []
    return competitors.some((c) => /^TBD(?:\s+(?:Home|Away))?$/i.test(c.team?.displayName ?? ''))
  }

  it('traz a liga bra.2 da temporada 2026 com calendário plano de datas', () => {
    const league = board.leagues?.[0]
    expect(league?.slug).toBe('bra.2')
    expect(league?.season?.year).toBe(2026)
    const calendar = league?.calendar ?? []
    expect(calendar.length).toBeGreaterThanOrEqual(5)
    expect(calendar.every((entry) => typeof entry === 'string')).toBe(true)
    for (const entry of calendar) {
      expect(Number.isFinite(Date.parse(String(entry)))).toBe(true)
    }
  })

  it('todo evento usa season.slug 2026-brasileiro-serie-b (padrão YYYY- de liga)', () => {
    expect(events.length).toBeGreaterThanOrEqual(5)
    for (const event of events) {
      expect(event.season?.year).toBe(2026)
      expect(event.season?.slug).toBe('2026-brasileiro-serie-b')
      expect(/^\d{4}-/.test(event.season?.slug ?? '')).toBe(true)
    }
  })

  it('eventos encerrados têm ids numéricos, nomes, FT e placar em string', () => {
    const done = finished(events)
    expect(done.length).toBeGreaterThanOrEqual(3)
    for (const event of done) {
      expect(event.id).toMatch(/^\d+$/)
      expect(Number.isFinite(Date.parse(event.date ?? ''))).toBe(true)
      const competitors = comp(event).competitors ?? []
      expect(competitors).toHaveLength(2)
      expect(competitors.map((c) => c.homeAway).sort()).toEqual(['away', 'home'])
      for (const competitor of competitors) {
        expect(competitor.team?.id).toMatch(/^\d+$/)
        expect(competitor.team?.displayName).toBeTruthy()
        expect(competitor.score).toMatch(/^\d+$/)
      }
      expect(comp(event).status?.type?.name).toBe('STATUS_FULL_TIME')
      expect(comp(event).status?.type?.detail).toBe('FT')
    }
  })

  it('jogo de liga não tem leg nem series', () => {
    expect(events.length).toBeGreaterThanOrEqual(1)
    for (const event of events) {
      expect(comp(event).leg ?? null).toBeNull()
      expect(comp(event).series ?? null).toBeNull()
    }
  })

  it('scoreboard ao vivo não traz week nem matchday (contrato da liga)', () => {
    // resolveEspnRound grava REGULAR_SEASON quando week/matchday faltam.
    // Ticket 06 não deve inventar número de rodada a partir deste payload.
    expect(events.length).toBeGreaterThanOrEqual(1)
    for (const event of events) {
      expect(event.week).toBeUndefined()
      expect(event.matchday).toBeUndefined()
      expect('week' in event).toBe(false)
      expect('matchday' in event).toBe(false)
    }
  })

  it('guarda jogo futuro com times reais e placar "0"', () => {
    const scheduledReal = events.filter(
      (e) => comp(e).status?.type?.state === 'pre' && !isTbdEvent(e),
    )
    expect(scheduledReal.length).toBeGreaterThanOrEqual(1)
    for (const event of scheduledReal) {
      for (const competitor of comp(event).competitors ?? []) {
        expect(competitor.score).toBe('0')
        expect(competitor.team?.id).toMatch(/^\d+$/)
        expect(competitor.team?.displayName).not.toMatch(/^TBD/i)
      }
    }
  })

  it('placeholders TBD são identificáveis por displayName e status.detail', () => {
    const tbds = events.filter(isTbdEvent)
    expect(tbds.length).toBeGreaterThanOrEqual(1)
    for (const event of tbds) {
      expect(comp(event).status?.type?.detail).toBe('TBD')
      const names = (comp(event).competitors ?? []).map((c) => c.team?.displayName)
      expect(names).toEqual(expect.arrayContaining(['TBD Home', 'TBD Away']))
    }
  })
})

/**
 * Contrato do Campeonato Paulista (copa com fases no slug e calendário plano).
 * Classificatória em `league-phase`, quartas/semis em jogo único, final em
 * ida/volta. Slugs `league-phase` e `finals` ainda estão fora do ESPN_STAGE_MAP.
 */
describe('fixture ESPN bra.camp.paulista', () => {
  const board = PAULISTA
  const events = board.events ?? []

  it('traz bra.camp.paulista da temporada 2026 com calendário plano de datas', () => {
    const league = board.leagues?.[0]
    expect(league?.slug).toBe('bra.camp.paulista')
    expect(league?.season?.year).toBe(2026)
    const calendar = league?.calendar ?? []
    expect(calendar.length).toBeGreaterThanOrEqual(5)
    expect(calendar.every((entry) => typeof entry === 'string')).toBe(true)
    for (const entry of calendar) {
      expect(Number.isFinite(Date.parse(String(entry)))).toBe(true)
    }
  })

  it('guarda as quatro fases observadas no season.slug', () => {
    const phases = new Set(events.map((e) => e.season?.slug))
    expect(phases).toEqual(
      new Set(['league-phase', 'quarterfinals', 'semifinals', 'finals']),
    )
  })

  it('todo evento tem data UTC, mandante/visitante e team.id numérico', () => {
    expect(events.length).toBeGreaterThanOrEqual(6)
    for (const event of events) {
      expect(event.id).toMatch(/^\d+$/)
      expect(Number.isFinite(Date.parse(event.date ?? ''))).toBe(true)
      expect(event.season?.year).toBe(2026)
      expect(event.season?.slug).toBeTruthy()
      const competitors = comp(event).competitors ?? []
      expect(competitors).toHaveLength(2)
      expect(competitors.map((c) => c.homeAway).sort()).toEqual(['away', 'home'])
      for (const competitor of competitors) {
        expect(competitor.team?.id).toMatch(/^\d+$/)
        expect(competitor.team?.displayName).toBeTruthy()
      }
    }
  })

  it('eventos encerrados trazem placar em string e status post FT ou FT-Pens', () => {
    const done = finished(events)
    expect(done.length).toBe(events.length)
    for (const event of done) {
      for (const competitor of comp(event).competitors ?? []) {
        expect(competitor.score).toMatch(/^\d+$/)
      }
      expect(comp(event).status?.type?.state).toBe('post')
      expect(['STATUS_FULL_TIME', 'STATUS_FINAL_PEN']).toContain(
        comp(event).status?.type?.name,
      )
      expect(['FT', 'FT-Pens']).toContain(comp(event).status?.type?.detail)
    }
  })

  it('classificatória league-phase não tem group, leg nem series', () => {
    const leaguePhase = events.filter((e) => e.season?.slug === 'league-phase')
    expect(leaguePhase.length).toBeGreaterThanOrEqual(2)
    for (const event of leaguePhase) {
      expect(comp(event).group ?? null).toBeNull()
      expect(comp(event).leg ?? null).toBeNull()
      expect(comp(event).series ?? null).toBeNull()
    }
  })

  it('quartas e semifinais são jogo único sem leg nem series', () => {
    const singleKo = events.filter((e) =>
      ['quarterfinals', 'semifinals'].includes(e.season?.slug ?? ''),
    )
    expect(singleKo.length).toBeGreaterThanOrEqual(2)
    for (const event of singleKo) {
      expect(comp(event).leg ?? null).toBeNull()
      expect(comp(event).series ?? null).toBeNull()
      expect(comp(event).group ?? null).toBeNull()
    }
  })

  it('quarta decidida nos pênaltis expõe shootoutScore e winner', () => {
    const pens = events.find((e) => e.id === '401861577')
    expect(pens).toBeTruthy()
    expect(pens?.season?.slug).toBe('quarterfinals')
    expect(comp(pens as FixtureEvent).status?.type?.name).toBe('STATUS_FINAL_PEN')
    expect(comp(pens as FixtureEvent).status?.type?.detail).toBe('FT-Pens')
    const competitors = comp(pens as FixtureEvent).competitors ?? []
    const corinthians = competitors.find((c) => c.team?.id === '874')
    const portuguesa = competitors.find((c) => c.team?.id === '4773')
    expect(corinthians?.shootoutScore).toBe(8)
    expect(portuguesa?.shootoutScore).toBe(7)
    expect(corinthians?.winner).toBe(true)
    expect(portuguesa?.winner).toBe(false)
    expect(comp(pens as FixtureEvent).leg ?? null).toBeNull()
    expect(comp(pens as FixtureEvent).series ?? null).toBeNull()
  })

  it('final liga ida e volta por leg e series, com agregado na volta', () => {
    const [leg1, leg2] = tiePair(events, 'finals')
    expect(leg1.date?.slice(0, 10)).toBe('2026-03-04')
    expect(leg2.date?.slice(0, 10)).toBe('2026-03-08')
    expect(comp(leg1).leg).toEqual({ value: 1, displayValue: '1st Leg' })
    expect(comp(leg2).leg).toEqual({ value: 2, displayValue: '2nd Leg' })
    expect(comp(leg1).series?.title).toBe('Finals')
    expect(comp(leg2).series?.title).toBe('Finals')
    expect(comp(leg1).series?.totalCompetitions).toBe(2)
    expect(comp(leg2).series?.totalCompetitions).toBe(2)
    expect(comp(leg1).series?.completed).toBe(false)
    expect(comp(leg2).series?.completed).toBe(true)

    expect(teamIdBySide(leg2, 'away')).toBe(teamIdBySide(leg1, 'home'))
    expect(teamIdBySide(leg2, 'home')).toBe(teamIdBySide(leg1, 'away'))

    for (const competitor of comp(leg1).competitors ?? []) {
      expect(competitor.aggregateScore).toBeUndefined()
    }
    const seriesByTeam = new Map(
      (comp(leg2).series?.competitors ?? []).map((c) => [c.id, c.aggregateScore]),
    )
    for (const competitor of comp(leg2).competitors ?? []) {
      expect(typeof competitor.aggregateScore).toBe('number')
      expect(seriesByTeam.get(competitor.team?.id ?? '')).toBe(competitor.aggregateScore)
    }
    const classified = (comp(leg2).series?.competitors ?? []).filter((c) => c.winner)
    expect(classified).toHaveLength(1)
    expect(classified[0]?.id).toBe('2029')
  })

  it('scoreboard ao vivo não traz week nem matchday', () => {
    expect(events.length).toBeGreaterThanOrEqual(1)
    for (const event of events) {
      expect(event.week).toBeUndefined()
      expect(event.matchday).toBeUndefined()
      expect('week' in event).toBe(false)
      expect('matchday' in event).toBe(false)
    }
  })

  it('altGameNote é sempre Brazil Paulista e não identifica a fase', () => {
    for (const event of events) {
      expect(comp(event).altGameNote).toBe('Brazil Paulista')
    }
  })

  it('nenhum evento da fixture tem group (contrato do scoreboard Paulista)', () => {
    for (const event of events) {
      expect(comp(event).group ?? null).toBeNull()
    }
  })
})

/**
 * Contrato do Campeonato Carioca (copa estadual). Fases próprias no season.slug
 * (Taça Guanabara, Taça Rio, rebaixamento), com `---` no literal ESPN. O mapa
 * atual de espnSync descartaria todos os sete slugs até o ticket de parser.
 */
describe('fixture ESPN bra.camp.carioca', () => {
  const board = CARIOCA
  const events = board.events ?? []

  it('traz bra.camp.carioca da temporada 2026 com calendário plano de datas', () => {
    const league = board.leagues?.[0]
    expect(league?.slug).toBe('bra.camp.carioca')
    expect(league?.season?.year).toBe(2026)
    const calendar = league?.calendar ?? []
    expect(calendar.length).toBeGreaterThanOrEqual(5)
    expect(calendar.every((entry) => typeof entry === 'string')).toBe(true)
    for (const entry of calendar) {
      expect(Number.isFinite(Date.parse(String(entry)))).toBe(true)
    }
  })

  it('guarda as sete fases observadas no season.slug', () => {
    const phases = new Set(events.map((e) => e.season?.slug))
    expect(phases).toEqual(
      new Set([
        'taca-guanabara',
        'taca-guanabara---quarterfinals',
        'taca-guanabara---semifinals',
        'taca-guanabara---final',
        'taca-rio---semifinals',
        'taca-rio---final',
        'relegation-stage',
      ]),
    )
  })

  it('todo evento tem data UTC, mandante/visitante e team.id numérico', () => {
    expect(events.length).toBeGreaterThanOrEqual(10)
    for (const event of events) {
      expect(event.id).toMatch(/^\d+$/)
      expect(Number.isFinite(Date.parse(event.date ?? ''))).toBe(true)
      expect(event.season?.year).toBe(2026)
      expect(event.season?.slug).toBeTruthy()
      const competitors = comp(event).competitors ?? []
      expect(competitors).toHaveLength(2)
      expect(competitors.map((c) => c.homeAway).sort()).toEqual(['away', 'home'])
      for (const competitor of competitors) {
        expect(competitor.team?.id).toMatch(/^\d+$/)
        expect(competitor.team?.displayName).toBeTruthy()
      }
    }
  })

  it('eventos encerrados trazem placar em string e status post FT ou FT-Pens', () => {
    const done = finished(events)
    expect(done.length).toBe(events.length)
    for (const event of done) {
      for (const competitor of comp(event).competitors ?? []) {
        expect(competitor.score).toMatch(/^\d+$/)
      }
      expect(comp(event).status?.type?.state).toBe('post')
      expect(['STATUS_FULL_TIME', 'STATUS_FINAL_PEN']).toContain(
        comp(event).status?.type?.name,
      )
      expect(['FT', 'FT-Pens']).toContain(comp(event).status?.type?.detail)
    }
  })

  it('fase de pontos taca-guanabara não tem leg nem series', () => {
    const leaguePhase = events.filter((e) => e.season?.slug === 'taca-guanabara')
    expect(leaguePhase.length).toBeGreaterThanOrEqual(2)
    for (const event of leaguePhase) {
      expect(comp(event).leg ?? null).toBeNull()
      expect(comp(event).series ?? null).toBeNull()
    }
  })

  it('guarda amostra de group na Taça Guanabara e no rebaixamento', () => {
    const tgWithGroup = events.find(
      (e) => e.season?.slug === 'taca-guanabara' && comp(e).group?.name === 'Group B',
    )
    expect(tgWithGroup).toBeTruthy()
    expect(comp(tgWithGroup as FixtureEvent).group?.groupId).toBe('2')

    const relegation = events.find((e) => e.season?.slug === 'relegation-stage')
    expect(relegation).toBeTruthy()
    expect(comp(relegation as FixtureEvent).group?.name).toBe('Relegation Group')
    expect(comp(relegation as FixtureEvent).leg ?? null).toBeNull()
    expect(comp(relegation as FixtureEvent).series ?? null).toBeNull()
  })

  it('quartas da Taça Guanabara são jogo único sem leg nem series', () => {
    const quarters = events.filter((e) => e.season?.slug === 'taca-guanabara---quarterfinals')
    expect(quarters.length).toBeGreaterThanOrEqual(2)
    for (const event of quarters) {
      expect(comp(event).leg ?? null).toBeNull()
      expect(comp(event).series ?? null).toBeNull()
      expect(comp(event).group ?? null).toBeNull()
    }
  })

  it('quarta decidida nos pênaltis expõe shootoutScore e winner', () => {
    const pens = events.find((e) => e.id === '401860540')
    expect(pens).toBeTruthy()
    expect(pens?.season?.slug).toBe('taca-guanabara---quarterfinals')
    expect(comp(pens as FixtureEvent).status?.type?.name).toBe('STATUS_FINAL_PEN')
    expect(comp(pens as FixtureEvent).status?.type?.detail).toBe('FT-Pens')
    const competitors = comp(pens as FixtureEvent).competitors ?? []
    const vasco = competitors.find((c) => c.team?.id === '3454')
    const volta = competitors.find((c) => c.team?.id === '4806')
    expect(vasco?.shootoutScore).toBe(5)
    expect(volta?.shootoutScore).toBe(3)
    expect(vasco?.winner).toBe(true)
    expect(volta?.winner).toBe(false)
  })

  it('semifinais da Taça Guanabara ligam ida e volta por leg e series, com agregado na volta', () => {
    const [leg1, leg2] = tiePair(events, 'taca-guanabara---semifinals')
    expect(leg1.date?.slice(0, 10)).toBe('2026-02-22')
    expect(leg2.date?.slice(0, 10)).toBe('2026-03-01')
    expect(comp(leg1).leg).toEqual({ value: 1, displayValue: '1st Leg' })
    expect(comp(leg2).leg).toEqual({ value: 2, displayValue: '2nd Leg' })
    expect(comp(leg1).series?.title).toBe('Taça Guanabara - Semifinals')
    expect(comp(leg2).series?.title).toBe('Taça Guanabara - Semifinals')
    expect(comp(leg1).series?.totalCompetitions).toBe(2)
    expect(comp(leg2).series?.totalCompetitions).toBe(2)
    expect(comp(leg1).series?.completed).toBe(false)
    expect(comp(leg2).series?.completed).toBe(true)

    expect(teamIdBySide(leg2, 'away')).toBe(teamIdBySide(leg1, 'home'))
    expect(teamIdBySide(leg2, 'home')).toBe(teamIdBySide(leg1, 'away'))

    for (const competitor of comp(leg1).competitors ?? []) {
      expect(competitor.aggregateScore).toBeUndefined()
    }
    const seriesByTeam = new Map(
      (comp(leg2).series?.competitors ?? []).map((c) => [c.id, c.aggregateScore]),
    )
    for (const competitor of comp(leg2).competitors ?? []) {
      expect(typeof competitor.aggregateScore).toBe('number')
      expect(seriesByTeam.get(competitor.team?.id ?? '')).toBe(competitor.aggregateScore)
    }
    const classified = (comp(leg2).series?.competitors ?? []).filter((c) => c.winner)
    expect(classified).toHaveLength(1)
    expect(classified[0]?.id).toBe('3445')
  })

  it('final da Taça Guanabara nos pênaltis expõe shootoutScore e winner sem series', () => {
    const final = events.find((e) => e.id === '401863456')
    expect(final).toBeTruthy()
    expect(final?.season?.slug).toBe('taca-guanabara---final')
    expect(comp(final as FixtureEvent).status?.type?.name).toBe('STATUS_FINAL_PEN')
    expect(comp(final as FixtureEvent).leg ?? null).toBeNull()
    expect(comp(final as FixtureEvent).series ?? null).toBeNull()
    const competitors = comp(final as FixtureEvent).competitors ?? []
    const flamengo = competitors.find((c) => c.team?.id === '819')
    const fluminense = competitors.find((c) => c.team?.id === '3445')
    expect(flamengo?.shootoutScore).toBe(5)
    expect(fluminense?.shootoutScore).toBe(4)
    expect(flamengo?.winner).toBe(true)
    expect(fluminense?.winner).toBe(false)
  })

  it('semifinais da Taça Rio ligam ida e volta por leg e series', () => {
    const [leg1, leg2] = tiePair(events, 'taca-rio---semifinals')
    expect(comp(leg1).series?.title).toBe('Taça Rio - Semifinals')
    expect(comp(leg2).series?.title).toBe('Taça Rio - Semifinals')
    expect(comp(leg1).series?.totalCompetitions).toBe(2)
    expect(comp(leg2).series?.completed).toBe(true)
    const classified = (comp(leg2).series?.competitors ?? []).filter((c) => c.winner)
    expect(classified).toHaveLength(1)
    expect(classified[0]?.id).toBe('10265')
  })

  it('final da Taça Rio é jogo único sem leg nem series', () => {
    const final = events.find((e) => e.season?.slug === 'taca-rio---final')
    expect(final).toBeTruthy()
    expect(comp(final as FixtureEvent).leg ?? null).toBeNull()
    expect(comp(final as FixtureEvent).series ?? null).toBeNull()
    expect(comp(final as FixtureEvent).status?.type?.name).toBe('STATUS_FULL_TIME')
    const botafogo = (comp(final as FixtureEvent).competitors ?? []).find(
      (c) => c.team?.id === '6086',
    )
    expect(botafogo?.winner).toBe(true)
  })

  it('scoreboard ao vivo não traz week nem matchday', () => {
    expect(events.length).toBeGreaterThanOrEqual(1)
    for (const event of events) {
      expect(event.week).toBeUndefined()
      expect(event.matchday).toBeUndefined()
      expect('week' in event).toBe(false)
      expect('matchday' in event).toBe(false)
    }
  })

  it('altGameNote é sempre Brazil Carioca e não identifica a fase', () => {
    for (const event of events) {
      expect(comp(event).altGameNote).toBe('Brazil Carioca')
    }
  })
})

/**
 * Contrato do Campeonato Mineiro (estadual com fases fatiadas). Calendário plano
 * de datas, season.slug por fase (incluindo Troféu Inconfidência e playoffs),
 * grupos A/B/C na classificatória, ida/volta com series nas semis/final do
 * troféu e nas semis dos playoffs, final do título em jogo único. Temporada
 * 2026 encerrada na coleta: sem state=pre nem TBD nesta fixture.
 */
describe('fixture ESPN bra.camp.mineiro', () => {
  const board = MINEIRO
  const events = board.events ?? []

  it('traz bra.camp.mineiro da temporada 2026 com calendário plano de datas', () => {
    const league = board.leagues?.[0]
    expect(league?.slug).toBe('bra.camp.mineiro')
    expect(league?.season?.year).toBe(2026)
    const calendar = league?.calendar ?? []
    expect(calendar.length).toBeGreaterThanOrEqual(5)
    expect(calendar.every((entry) => typeof entry === 'string')).toBe(true)
    for (const entry of calendar) {
      expect(Number.isFinite(Date.parse(String(entry)))).toBe(true)
    }
  })

  it('guarda as cinco fases observadas no season.slug', () => {
    const phases = new Set(events.map((e) => e.season?.slug))
    expect(phases).toEqual(
      new Set([
        'regular-season',
        'trofeu-inconfidencia---semifinals',
        'trofeu-inconfidencia---finals',
        'playoffs---semifinals',
        'playoffs---final',
      ]),
    )
  })

  it('todo evento tem data UTC, mandante/visitante e team.id numérico', () => {
    expect(events.length).toBeGreaterThanOrEqual(9)
    for (const event of events) {
      expect(event.id).toMatch(/^\d+$/)
      expect(Number.isFinite(Date.parse(event.date ?? ''))).toBe(true)
      expect(event.season?.year).toBe(2026)
      expect(event.season?.slug).toBeTruthy()
      const competitors = comp(event).competitors ?? []
      expect(competitors).toHaveLength(2)
      expect(competitors.map((c) => c.homeAway).sort()).toEqual(['away', 'home'])
      for (const competitor of competitors) {
        expect(competitor.team?.id).toMatch(/^\d+$/)
        expect(competitor.team?.displayName).toBeTruthy()
      }
    }
  })

  it('eventos encerrados trazem placar em string e status post FT ou FT-Pens', () => {
    const done = finished(events)
    expect(done.length).toBe(events.length)
    for (const event of done) {
      for (const competitor of comp(event).competitors ?? []) {
        expect(competitor.score).toMatch(/^\d+$/)
      }
      expect(comp(event).status?.type?.state).toBe('post')
      expect(['STATUS_FULL_TIME', 'STATUS_FINAL_PEN']).toContain(
        comp(event).status?.type?.name,
      )
      expect(['FT', 'FT-Pens']).toContain(comp(event).status?.type?.detail)
    }
  })

  it('classificatória regular-season expõe grupos A/B/C e não tem leg nem series', () => {
    const leaguePhase = events.filter((e) => e.season?.slug === 'regular-season')
    expect(leaguePhase.length).toBeGreaterThanOrEqual(3)
    const groupNames = new Set(
      leaguePhase.map((e) => comp(e).group?.name).filter(Boolean),
    )
    expect(groupNames).toEqual(new Set(['Group A', 'Group B', 'Group C']))
    for (const event of leaguePhase) {
      expect(comp(event).group?.groupId).toMatch(/^[123]$/)
      expect(comp(event).leg ?? null).toBeNull()
      expect(comp(event).series ?? null).toBeNull()
    }
  })

  it('semifinal do Troféu Inconfidência liga ida e volta por leg e series, com pênaltis na volta', () => {
    const [leg1, leg2] = tiePair(events, 'trofeu-inconfidencia---semifinals')
    expect(leg1.date?.slice(0, 10)).toBe('2026-02-21')
    expect(leg2.date?.slice(0, 10)).toBe('2026-03-01')
    expect(comp(leg1).leg).toEqual({ value: 1, displayValue: '1st Leg' })
    expect(comp(leg2).leg).toEqual({ value: 2, displayValue: '2nd Leg' })
    expect(comp(leg1).series?.title).toBe('Troféu Inconfidência - Semifinals')
    expect(comp(leg2).series?.title).toBe('Troféu Inconfidência - Semifinals')
    expect(comp(leg1).series?.totalCompetitions).toBe(2)
    expect(comp(leg2).series?.totalCompetitions).toBe(2)
    expect(comp(leg1).series?.completed).toBe(false)
    expect(comp(leg2).series?.completed).toBe(true)
    expect(comp(leg1).group ?? null).toBeNull()
    expect(comp(leg2).group ?? null).toBeNull()

    expect(teamIdBySide(leg2, 'away')).toBe(teamIdBySide(leg1, 'home'))
    expect(teamIdBySide(leg2, 'home')).toBe(teamIdBySide(leg1, 'away'))

    for (const competitor of comp(leg1).competitors ?? []) {
      expect(competitor.aggregateScore).toBeUndefined()
    }

    expect(comp(leg2).status?.type?.name).toBe('STATUS_FINAL_PEN')
    expect(comp(leg2).status?.type?.detail).toBe('FT-Pens')
    const competitors = comp(leg2).competitors ?? []
    const north = competitors.find((c) => c.team?.id === '131565')
    const uberlandia = competitors.find((c) => c.team?.id === '9460')
    expect(north?.shootoutScore).toBe(4)
    expect(uberlandia?.shootoutScore).toBe(3)
    expect(north?.winner).toBe(true)
    expect(uberlandia?.winner).toBe(false)
    expect(north?.aggregateScore).toBe(1)
    expect(uberlandia?.aggregateScore).toBe(1)

    const seriesByTeam = new Map(
      (comp(leg2).series?.competitors ?? []).map((c) => [c.id, c.aggregateScore]),
    )
    expect(seriesByTeam.get('131565')).toBe(1)
    expect(seriesByTeam.get('9460')).toBe(1)
    const classified = (comp(leg2).series?.competitors ?? []).filter((c) => c.winner)
    expect(classified).toHaveLength(1)
    expect(classified[0]?.id).toBe('131565')
  })

  it('semifinal dos playoffs liga ida e volta por leg e series, com pênaltis na volta', () => {
    const [leg1, leg2] = tiePair(events, 'playoffs---semifinals')
    expect(leg1.date?.slice(0, 10)).toBe('2026-02-22')
    expect(leg2.date?.slice(0, 10)).toBe('2026-03-01')
    expect(comp(leg1).leg).toEqual({ value: 1, displayValue: '1st Leg' })
    expect(comp(leg2).leg).toEqual({ value: 2, displayValue: '2nd Leg' })
    expect(comp(leg1).series?.title).toBe('Playoffs - Semifinals')
    expect(comp(leg2).series?.title).toBe('Playoffs - Semifinals')
    expect(comp(leg1).series?.completed).toBe(false)
    expect(comp(leg2).series?.completed).toBe(true)

    expect(teamIdBySide(leg2, 'away')).toBe(teamIdBySide(leg1, 'home'))
    expect(teamIdBySide(leg2, 'home')).toBe(teamIdBySide(leg1, 'away'))

    expect(comp(leg2).status?.type?.name).toBe('STATUS_FINAL_PEN')
    const competitors = comp(leg2).competitors ?? []
    const atletico = competitors.find((c) => c.team?.id === '7632')
    const america = competitors.find((c) => c.team?.id === '6154')
    expect(atletico?.shootoutScore).toBe(4)
    expect(america?.shootoutScore).toBe(2)
    expect(atletico?.winner).toBe(true)
    expect(america?.winner).toBe(false)
    const classified = (comp(leg2).series?.competitors ?? []).filter((c) => c.winner)
    expect(classified).toHaveLength(1)
    expect(classified[0]?.id).toBe('7632')
  })

  it('final do Troféu Inconfidência liga ida e volta por leg e series, com agregado na volta', () => {
    const [leg1, leg2] = tiePair(events, 'trofeu-inconfidencia---finals')
    expect(leg1.date?.slice(0, 10)).toBe('2026-03-04')
    expect(leg2.date?.slice(0, 10)).toBe('2026-03-07')
    expect(comp(leg1).leg).toEqual({ value: 1, displayValue: '1st Leg' })
    expect(comp(leg2).leg).toEqual({ value: 2, displayValue: '2nd Leg' })
    expect(comp(leg1).series?.title).toBe('Troféu Inconfidência - Finals')
    expect(comp(leg2).series?.title).toBe('Troféu Inconfidência - Finals')
    expect(comp(leg1).series?.totalCompetitions).toBe(2)
    expect(comp(leg2).series?.completed).toBe(true)

    for (const competitor of comp(leg1).competitors ?? []) {
      expect(competitor.aggregateScore).toBeUndefined()
    }
    const seriesByTeam = new Map(
      (comp(leg2).series?.competitors ?? []).map((c) => [c.id, c.aggregateScore]),
    )
    for (const competitor of comp(leg2).competitors ?? []) {
      expect(typeof competitor.aggregateScore).toBe('number')
      expect(seriesByTeam.get(competitor.team?.id ?? '')).toBe(competitor.aggregateScore)
    }
    const classified = (comp(leg2).series?.competitors ?? []).filter((c) => c.winner)
    expect(classified).toHaveLength(1)
    expect(classified[0]?.id).toBe('131565')
  })

  it('final dos playoffs é jogo único sem leg nem series', () => {
    const final = events.find((e) => e.season?.slug === 'playoffs---final')
    expect(final).toBeTruthy()
    expect(final?.id).toBe('401863457')
    expect(comp(final as FixtureEvent).leg ?? null).toBeNull()
    expect(comp(final as FixtureEvent).series ?? null).toBeNull()
    expect(comp(final as FixtureEvent).group ?? null).toBeNull()
    expect(comp(final as FixtureEvent).status?.type?.name).toBe('STATUS_FULL_TIME')
    const cruzeiro = (comp(final as FixtureEvent).competitors ?? []).find(
      (c) => c.team?.id === '2022',
    )
    const atletico = (comp(final as FixtureEvent).competitors ?? []).find(
      (c) => c.team?.id === '7632',
    )
    expect(cruzeiro?.winner).toBe(true)
    expect(atletico?.winner).toBe(false)
    expect(cruzeiro?.score).toBe('1')
    expect(atletico?.score).toBe('0')
  })

  it('scoreboard ao vivo não traz week nem matchday', () => {
    expect(events.length).toBeGreaterThanOrEqual(1)
    for (const event of events) {
      expect(event.week).toBeUndefined()
      expect(event.matchday).toBeUndefined()
      expect('week' in event).toBe(false)
      expect('matchday' in event).toBe(false)
    }
  })

  it('altGameNote é sempre Brazil Mineiro e não identifica a fase', () => {
    for (const event of events) {
      expect(comp(event).altGameNote).toBe('Brazil Mineiro')
    }
  })
})

const GAUCHO = gauchoJson as unknown as FixtureBoard

/** Team ids ESPN do Grenal, conferidos na fixture. */
const GREMIO_ID = '6273'
const INTERNACIONAL_ID = '1936'

/**
 * Contrato do Campeonato Gaúcho (bra.camp.gaucho). Calendário plano de datas,
 * season.slug fatiado em fases (type cup), grupos incompletos na first-round,
 * rebaixamento, mata-mata com leg/series e Grenal na final.
 */
describe('fixture ESPN bra.camp.gaucho', () => {
  const board = GAUCHO
  const events = board.events ?? []

  it('traz bra.camp.gaucho da temporada 2026 com calendário plano de datas', () => {
    const league = board.leagues?.[0]
    expect(league?.slug).toBe('bra.camp.gaucho')
    expect(league?.season?.year).toBe(2026)
    const calendar = league?.calendar ?? []
    expect(calendar.length).toBeGreaterThanOrEqual(5)
    expect(calendar.every((entry) => typeof entry === 'string')).toBe(true)
    for (const entry of calendar) {
      expect(Number.isFinite(Date.parse(String(entry)))).toBe(true)
    }
  })

  it('guarda as sete fases observadas no season.slug', () => {
    const phases = new Set(events.map((e) => e.season?.slug))
    expect(phases).toEqual(
      new Set([
        'first-round',
        'gaucho---relegation',
        'quarterfinals',
        'farroupilha---semifinals',
        'semifinals',
        'finals',
        'farroupilha---finals',
      ]),
    )
  })

  it('todo evento tem data UTC, mandante/visitante e team.id numérico', () => {
    expect(events.length).toBeGreaterThanOrEqual(10)
    for (const event of events) {
      expect(event.id).toMatch(/^\d+$/)
      expect(Number.isFinite(Date.parse(event.date ?? ''))).toBe(true)
      expect(event.season?.year).toBe(2026)
      expect(event.season?.slug).toBeTruthy()
      const competitors = comp(event).competitors ?? []
      expect(competitors).toHaveLength(2)
      expect(competitors.map((c) => c.homeAway).sort()).toEqual(['away', 'home'])
      for (const competitor of competitors) {
        expect(competitor.team?.id).toMatch(/^\d+$/)
        expect(competitor.team?.displayName).toBeTruthy()
      }
    }
  })

  it('eventos encerrados trazem placar em string e status post FT ou FT-Pens', () => {
    const done = finished(events)
    expect(done.length).toBe(events.length)
    for (const event of done) {
      for (const competitor of comp(event).competitors ?? []) {
        expect(competitor.score).toMatch(/^\d+$/)
      }
      expect(comp(event).status?.type?.state).toBe('post')
      expect(['STATUS_FULL_TIME', 'STATUS_FINAL_PEN']).toContain(comp(event).status?.type?.name)
      expect(['FT', 'FT-Pens']).toContain(comp(event).status?.type?.detail)
    }
  })

  it('first-round mistura jogo com Group A e jogo sem group, sem leg nem series', () => {
    const firstRound = events.filter((e) => e.season?.slug === 'first-round')
    expect(firstRound.length).toBeGreaterThanOrEqual(2)
    const withGroup = firstRound.filter((e) => comp(e).group?.name)
    const withoutGroup = firstRound.filter((e) => !comp(e).group)
    expect(withGroup.length).toBeGreaterThanOrEqual(1)
    expect(withoutGroup.length).toBeGreaterThanOrEqual(1)
    expect(withGroup[0]?.date).toBe('2026-01-11T00:00Z')
    expect(comp(withGroup[0] as FixtureEvent).group?.name).toBe(
      '2026 Campeonato Gaúcho - Group A',
    )
    expect(comp(withGroup[0] as FixtureEvent).group?.groupId).toBe('1')
    for (const event of firstRound) {
      expect(comp(event).leg ?? null).toBeNull()
      expect(comp(event).series ?? null).toBeNull()
    }
  })

  it('fase gaucho---relegation expõe Relegation Group sem leg nem series', () => {
    const relegation = events.filter((e) => e.season?.slug === 'gaucho---relegation')
    expect(relegation.length).toBeGreaterThanOrEqual(1)
    for (const event of relegation) {
      expect(comp(event).group?.name).toBe('Relegation Group')
      expect(comp(event).group?.groupId).toBe('1')
      expect(comp(event).leg ?? null).toBeNull()
      expect(comp(event).series ?? null).toBeNull()
    }
  })

  it('quarterfinals é jogo único sem leg nem series', () => {
    const quarters = events.filter((e) => e.season?.slug === 'quarterfinals')
    expect(quarters.length).toBeGreaterThanOrEqual(1)
    for (const event of quarters) {
      expect(comp(event).leg ?? null).toBeNull()
      expect(comp(event).series ?? null).toBeNull()
      expect(comp(event).group ?? null).toBeNull()
      expect(comp(event).status?.type?.name).toBe('STATUS_FULL_TIME')
    }
    const caxiasYpiranga = quarters.find((e) => e.id === '401858934')
    expect(caxiasYpiranga).toBeTruthy()
    expect(teamIdBySide(caxiasYpiranga as FixtureEvent, 'home')).toBe('17131')
    expect(teamIdBySide(caxiasYpiranga as FixtureEvent, 'away')).toBe('4935')
    const competitors = comp(caxiasYpiranga as FixtureEvent).competitors ?? []
    const caxias = competitors.find((c) => c.team?.id === '17131')
    const ypiranga = competitors.find((c) => c.team?.id === '4935')
    expect(ypiranga?.winner).toBe(true)
    expect(caxias?.winner).toBe(false)
  })

  it('farroupilha---semifinals liga ida e volta por leg e series, com pênaltis na volta', () => {
    const [leg1, leg2] = tiePair(events, 'farroupilha---semifinals')
    expect(leg1.date?.slice(0, 10)).toBe('2026-02-16')
    expect(leg2.date?.slice(0, 10)).toBe('2026-02-21')
    expect(comp(leg1).leg).toEqual({ value: 1, displayValue: '1st Leg' })
    expect(comp(leg2).leg).toEqual({ value: 2, displayValue: '2nd Leg' })
    expect(comp(leg1).series?.title).toBe('Farroupilha - Semifinals')
    expect(comp(leg2).series?.title).toBe('Farroupilha - Semifinals')
    expect(comp(leg1).series?.totalCompetitions).toBe(2)
    expect(comp(leg2).series?.totalCompetitions).toBe(2)
    expect(comp(leg1).series?.completed).toBe(false)
    expect(comp(leg2).series?.completed).toBe(true)

    expect(teamIdBySide(leg2, 'away')).toBe(teamIdBySide(leg1, 'home'))
    expect(teamIdBySide(leg2, 'home')).toBe(teamIdBySide(leg1, 'away'))

    for (const competitor of comp(leg1).competitors ?? []) {
      expect(competitor.aggregateScore).toBeUndefined()
    }

    expect(comp(leg2).status?.type?.name).toBe('STATUS_FINAL_PEN')
    expect(comp(leg2).status?.type?.detail).toBe('FT-Pens')
    const competitors = comp(leg2).competitors ?? []
    const caxias = competitors.find((c) => c.team?.id === '17131')
    const saoLuiz = competitors.find((c) => c.team?.id === '7391')
    expect(caxias?.shootoutScore).toBe(2)
    expect(saoLuiz?.shootoutScore).toBe(3)
    expect(caxias?.winner).toBe(false)
    expect(saoLuiz?.winner).toBe(true)
    expect(caxias?.aggregateScore).toBe(2)
    expect(saoLuiz?.aggregateScore).toBe(2)

    const seriesByTeam = new Map(
      (comp(leg2).series?.competitors ?? []).map((c) => [c.id, c.aggregateScore]),
    )
    expect(seriesByTeam.get('17131')).toBe(2)
    expect(seriesByTeam.get('7391')).toBe(2)
    const classified = (comp(leg2).series?.competitors ?? []).filter((c) => c.winner)
    expect(classified).toHaveLength(1)
    expect(classified[0]?.id).toBe('7391')
  })

  it('semifinals liga ida e volta por leg e series, com pênaltis na volta', () => {
    const [leg1, leg2] = tiePair(events, 'semifinals')
    expect(leg1.date?.slice(0, 10)).toBe('2026-02-15')
    expect(leg2.date?.slice(0, 10)).toBe('2026-02-22')
    expect(comp(leg1).leg).toEqual({ value: 1, displayValue: '1st Leg' })
    expect(comp(leg2).leg).toEqual({ value: 2, displayValue: '2nd Leg' })
    expect(comp(leg1).series?.title).toBe('Semifinals')
    expect(comp(leg2).series?.title).toBe('Semifinals')
    expect(comp(leg1).series?.completed).toBe(false)
    expect(comp(leg2).series?.completed).toBe(true)

    expect(teamIdBySide(leg2, 'away')).toBe(teamIdBySide(leg1, 'home'))
    expect(teamIdBySide(leg2, 'home')).toBe(teamIdBySide(leg1, 'away'))

    expect(comp(leg2).status?.type?.name).toBe('STATUS_FINAL_PEN')
    expect(comp(leg2).status?.type?.detail).toBe('FT-Pens')
    const competitors = comp(leg2).competitors ?? []
    const juventude = competitors.find((c) => c.team?.id === '6270')
    const gremio = competitors.find((c) => c.team?.id === GREMIO_ID)
    expect(juventude?.shootoutScore).toBe(1)
    expect(gremio?.shootoutScore).toBe(4)
    expect(juventude?.winner).toBe(false)
    expect(gremio?.winner).toBe(true)
    expect(juventude?.aggregateScore).toBe(2)
    expect(gremio?.aggregateScore).toBe(2)
    const classified = (comp(leg2).series?.competitors ?? []).filter((c) => c.winner)
    expect(classified).toHaveLength(1)
    expect(classified[0]?.id).toBe(GREMIO_ID)
  })

  it('finals do título é Grenal em ida e volta com agregado e winner na series', () => {
    const [leg1, leg2] = tiePair(events, 'finals')
    expect(leg1.date?.slice(0, 10)).toBe('2026-03-01')
    expect(leg2.date?.slice(0, 10)).toBe('2026-03-08')
    expect(comp(leg1).leg).toEqual({ value: 1, displayValue: '1st Leg' })
    expect(comp(leg2).leg).toEqual({ value: 2, displayValue: '2nd Leg' })
    expect(comp(leg1).series?.title).toBe('Finals')
    expect(comp(leg2).series?.title).toBe('Finals')
    expect(comp(leg1).series?.totalCompetitions).toBe(2)
    expect(comp(leg1).series?.completed).toBe(false)
    expect(comp(leg2).series?.completed).toBe(true)

    expect(teamIdBySide(leg1, 'home')).toBe(GREMIO_ID)
    expect(teamIdBySide(leg1, 'away')).toBe(INTERNACIONAL_ID)
    expect(teamIdBySide(leg2, 'home')).toBe(INTERNACIONAL_ID)
    expect(teamIdBySide(leg2, 'away')).toBe(GREMIO_ID)

    for (const competitor of comp(leg1).competitors ?? []) {
      expect(competitor.aggregateScore).toBeUndefined()
    }
    const seriesByTeam = new Map(
      (comp(leg2).series?.competitors ?? []).map((c) => [c.id, c.aggregateScore]),
    )
    for (const competitor of comp(leg2).competitors ?? []) {
      expect(typeof competitor.aggregateScore).toBe('number')
      expect(seriesByTeam.get(competitor.team?.id ?? '')).toBe(competitor.aggregateScore)
    }
    expect(seriesByTeam.get(GREMIO_ID)).toBe(4)
    expect(seriesByTeam.get(INTERNACIONAL_ID)).toBe(1)
    const classified = (comp(leg2).series?.competitors ?? []).filter((c) => c.winner)
    expect(classified).toHaveLength(1)
    expect(classified[0]?.id).toBe(GREMIO_ID)
  })

  it('farroupilha---finals liga ida e volta por leg e series com agregado na volta', () => {
    const [leg1, leg2] = tiePair(events, 'farroupilha---finals')
    expect(leg1.date?.slice(0, 10)).toBe('2026-03-02')
    expect(leg2.date?.slice(0, 10)).toBe('2026-03-06')
    expect(comp(leg1).leg).toEqual({ value: 1, displayValue: '1st Leg' })
    expect(comp(leg2).leg).toEqual({ value: 2, displayValue: '2nd Leg' })
    expect(comp(leg1).series?.title).toBe('Farroupilha - Finals')
    expect(comp(leg2).series?.title).toBe('Farroupilha - Finals')
    expect(comp(leg1).series?.totalCompetitions).toBe(2)
    expect(comp(leg2).series?.completed).toBe(true)

    for (const competitor of comp(leg1).competitors ?? []) {
      expect(competitor.aggregateScore).toBeUndefined()
    }
    const classified = (comp(leg2).series?.competitors ?? []).filter((c) => c.winner)
    expect(classified).toHaveLength(1)
    expect(classified[0]?.id).toBe('7391')
  })

  it('guarda Grenal também na first-round com mando e ids corretos', () => {
    const grenal = events.find(
      (e) =>
        e.season?.slug === 'first-round' &&
        ((teamIdBySide(e, 'home') === INTERNACIONAL_ID && teamIdBySide(e, 'away') === GREMIO_ID) ||
          (teamIdBySide(e, 'home') === GREMIO_ID && teamIdBySide(e, 'away') === INTERNACIONAL_ID)),
    )
    expect(grenal).toBeTruthy()
    expect(grenal?.id).toBe('762039')
    expect(grenal?.date).toBe('2026-01-25T23:00Z')
    expect(teamIdBySide(grenal as FixtureEvent, 'home')).toBe(INTERNACIONAL_ID)
    expect(teamIdBySide(grenal as FixtureEvent, 'away')).toBe(GREMIO_ID)
    const home = (comp(grenal as FixtureEvent).competitors ?? []).find((c) => c.homeAway === 'home')
    const away = (comp(grenal as FixtureEvent).competitors ?? []).find((c) => c.homeAway === 'away')
    expect(home?.score).toBe('4')
    expect(away?.score).toBe('2')
  })

  it('scoreboard ao vivo não traz week nem matchday', () => {
    expect(events.length).toBeGreaterThanOrEqual(1)
    for (const event of events) {
      expect(event.week).toBeUndefined()
      expect(event.matchday).toBeUndefined()
      expect('week' in event).toBe(false)
      expect('matchday' in event).toBe(false)
    }
  })

  it('altGameNote é sempre Brazil Gaucho e não identifica a fase', () => {
    for (const event of events) {
      expect(comp(event).altGameNote).toBe('Brazil Gaucho')
    }
  })
})
