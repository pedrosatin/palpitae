import { performance } from 'perf_hooks';
import { exportRecentDays } from './src/observability/export';

async function runBenchmark() {
  const overrides = {
    EVENTS: {
      head: async (key: string) => null,
      put: async (key: string, value: string, opts: any) => {}
    },
    CF_ACCOUNT_ID: 'acct',
    AE_SQL_TOKEN: 'tok'
  };

  // Mock global fetch for runAeSql
  global.fetch = async (url, options) => {
    // Add small delay to simulate network latency
    await new Promise(resolve => setTimeout(resolve, 5));
    return {
      ok: true,
      json: async () => ({ data: [{ a: 1 }] })
    } as any;
  };

  const env = overrides as any;
  const start = performance.now();
  await exportRecentDays(env, new Date('2026-06-30T00:00:00Z'), 10);
  const end = performance.now();

  console.log(`Time taken: ${(end - start).toFixed(2)}ms`);
}

runBenchmark().catch(console.error);
