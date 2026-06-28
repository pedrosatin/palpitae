import { syncFixtures } from './src/matches/sync.js';

// Setup fake DB
function buildFakeDb() {
  const captured = { competition: [], teams: [], matches: [] }
  const sqls = { match: '' }
  let queryCount = 0;

  const db = {
    prepare(sql: string) {
      let bound: unknown[] = []
      const stmt = {
        bind(...args: unknown[]) {
          bound = args
          return stmt
        },
        async run() {
          if (sql.includes('INSERT INTO competitions')) captured.competition.push(bound)
          else if (sql.includes('INSERT INTO teams')) captured.teams.push(bound)
          else if (sql.includes('INSERT INTO matches')) {
            captured.matches.push(bound)
            sqls.match = sql
          }
        },
        async first(): Promise<{id: string} | null> {
          queryCount++;
          if (sql.includes('SELECT id FROM competitions')) return { id: 'comp-1' }
          if (sql.includes('SELECT id FROM teams')) {
             if (sql.includes('IN (')) {
               return null; // Don't match the new query here if testing old
             }
            return { id: `team-${bound[0]}` }
          }
          return null
        },
        async all(): Promise<{results: any[]}> {
          queryCount++;
          if (sql.includes('SELECT external_id, id FROM teams')) {
             const results = bound.slice(0, bound.length - 1).map(id => ({ external_id: id, id: `team-${id}`}));
             return { results };
          }
          return {results: []};
        }
      }
      return stmt
    },
    getQueryCount() {
       return queryCount;
    }
  }

  return { db: db as never, captured, sqls }
}


const fakeMatches = Array.from({length: 100}).map((_, i) => ({
    id: i,
    utcDate: '2026-07-19T19:00:00Z',
    status: 'FINISHED',
    matchday: null,
    stage: 'FINAL',
    group: null,
    homeTeam: { id: i*2, name: `Team ${i*2}`, shortName: `T${i*2}`, tla: `T${i*2}`, crest: '' },
    awayTeam: { id: i*2+1, name: `Team ${i*2+1}`, shortName: `T${i*2+1}`, tla: `T${i*2+1}`, crest: '' },
    score: {
      winner: null,
      duration: 'REGULAR',
      fullTime: { home: null, away: null },
      halfTime: { home: null, away: null },
    },
}));


globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
    return {
        competition: { id: 2000, name: 'FIFA World Cup', code: 'WC' },
        matches: fakeMatches,
    }
    },
    async text() {
    return ''
    },
}) as any;


async function run() {
   const { db } = buildFakeDb();
   const start = performance.now();

   await syncFixtures({ competitionCode: 'WC', season: 2026, apiKey: 'k', db: db as any });

   const end = performance.now();
   console.log(`Execution time: ${(end - start).toFixed(2)} ms`);
   console.log(`Queries executed: ${db.getQueryCount()}`);
}

run().catch(console.error);
