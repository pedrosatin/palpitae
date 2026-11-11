import { useEffect, useState } from 'react'

/** Maior atraso que o `setTimeout` aceita. Acima dele o timer dispararia na hora. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1

/** Primeiro horário de `startTimes` depois de `now`, em ms. `null` quando não há. */
function nextStart(startTimes: readonly string[], now: number): number | null {
  let next: number | null = null
  for (const startTime of startTimes) {
    const at = Date.parse(startTime)
    if (at > now && (next === null || at < next)) next = at
  }
  return next
}

/**
 * Hora atual em ms, renovada a cada `intervalMs`. Serve ao que muda com o relógio,
 * como o "fecha em 2 h 15 min" do cabeçalho da rodada e o travamento dos cards.
 *
 * Com `startTimes`, a hora também é renovada no próximo desses horários, sem
 * esperar o intervalo. O card trava no início do jogo, como a API.
 */
export function useNow(intervalMs: number, startTimes: readonly string[] = []): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  const next = nextStart(startTimes, now)
  useEffect(() => {
    if (next === null) return
    const delay = next - Date.now()
    if (delay > MAX_TIMEOUT_MS) return
    // O relógio do sistema pode estar alguns ms atrás do timer. Sem o `max`, a hora
    // ficaria antes do início e o card só travaria no intervalo seguinte.
    const id = setTimeout(() => setNow(Math.max(Date.now(), next)), Math.max(0, delay))
    return () => clearTimeout(id)
  }, [next])

  return now
}
