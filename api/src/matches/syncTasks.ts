import { ESPN_MAX_CONCURRENT_COMPETITIONS } from './espnQuota'
import { FD_MAX_CONCURRENT_REQUESTS, runWithConcurrency } from './footballDataQuota'

/**
 * Roda as tarefas de sync separadas por provedor, cada grupo com o próprio teto:
 * a football-data compartilha 10 req/min, e a ESPN tem teto próprio mais pacing
 * HTTP. Os dois grupos andam em paralelo. Devolve os resultados da football-data
 * e depois os da ESPN, cada grupo na ordem de entrada.
 */
export async function runSyncTasks<T, R>(
  tasks: T[],
  providerOf: (task: T) => string | undefined,
  run: (task: T) => Promise<R>,
): Promise<R[]> {
  const fdTasks = tasks.filter((task) => providerOf(task) === 'football-data')
  const espnTasks = tasks.filter((task) => providerOf(task) === 'espn')
  const [fdResults, espnResults] = await Promise.all([
    runWithConcurrency(FD_MAX_CONCURRENT_REQUESTS, fdTasks, run),
    runWithConcurrency(ESPN_MAX_CONCURRENT_COMPETITIONS, espnTasks, run),
  ])
  return [...fdResults, ...espnResults]
}
