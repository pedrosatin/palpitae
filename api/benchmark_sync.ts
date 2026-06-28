import { syncFixtures } from './src/matches/sync'

// Fake D1 with simulated latency to show batching difference
function buildFakeDbWithLatency() {
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind(...args: unknown[]) {
          return stmt
        },
        async run() {
          await new Promise(r => setTimeout(r, 10)) // 10ms simulated latency
        },
        async first<T>(): Promise<T | null> {
          await new Promise(r => setTimeout(r, 10))
          if (sql.includes('SELECT id FROM competitions')) return { id: 'comp-1' } as T
          if (sql.includes('SELECT id FROM teams')) {
            return { id: `team-x` } as T
          }
          return null
        },
      }
      return stmt
    },
    async batch(statements: any[]) {
      await new Promise(r => setTimeout(r, 10)) // 10ms simulated latency for the entire batch
      for (const s of statements) {
        // Just call it synchronously so it doesn't incur additional async sleeps for each
        if (s.runOriginal) {
          s.runOriginal()
        }
      }
    }
  }

  return { db: db as never }
}

function mockFetch(matchesCount: number) {
  const matches = []
  for (let i = 0; i < matchesCount; i++) {
    matches.push({
      id: 1000 + i,
      utcDate: '2026-07-19T19:00:00Z',
      status: 'FINISHED',
      matchday: null,
      stage: 'GROUP',
      group: null,
      homeTeam: { id: i * 2 + 1, name: `Team ${i * 2 + 1}`, shortName: `T${i * 2 + 1}`, tla: `T${i * 2 + 1}` },
      awayTeam: { id: i * 2 + 2, name: `Team ${i * 2 + 2}`, shortName: `T${i * 2 + 2}`, tla: `T${i * 2 + 2}` },
      score: {
        winner: null,
        duration: 'REGULAR',
        fullTime: { home: null, away: null },
        halfTime: { home: null, away: null },
      },
    })
  }

  const globalFetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        competition: { id: 2000, name: 'Test Comp', code: 'TC' },
        matches,
      }
    },
    async text() {
      return ''
    },
  })

  globalThis.fetch = globalFetch as any
}

async function runBenchmark() {
  const numMatches = 50 // 50 matches = 100 teams
  mockFetch(numMatches)
  const { db } = buildFakeDbWithLatency()

  const start = performance.now()
  await syncFixtures({ competitionCode: 'TC', season: 2026, apiKey: 'k', db })
  const end = performance.now()

  console.log(`Baseline Execution Time: ${(end - start).toFixed(2)}ms for ${numMatches} matches and 100 teams`)
}

runBenchmark().catch(console.error)
