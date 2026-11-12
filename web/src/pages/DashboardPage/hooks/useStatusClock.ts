import { useEffect, useRef } from 'react'
import { useNow } from '../../../hooks/useNow'
import { lastPassedBoundary, statusBoundaries, type RoundStatusFields } from '../../../lib/dashboardStatus'

/** Renova os horários curtos ("hoje 18:30") sem esperar um início de jogo. */
const TICK_MS = 60_000

/**
 * Hora do painel. Quando ela passa um horário de `statusBoundaries`, os números
 * do `GET /groups` ficaram velhos e `refresh` busca a lista de novo.
 *
 * Cada horário dispara uma busca só. Se o relógio do aparelho estiver adiantado,
 * a API pode devolver o mesmo horário, ainda futuro para ela. A tela espera o
 * próximo horário, sem repetir a busca em laço.
 */
export function useStatusClock(groups: RoundStatusFields[], refresh: () => void): number {
  const boundaries = statusBoundaries(groups)
  const now = useNow(TICK_MS, boundaries)
  const passed = lastPassedBoundary(boundaries, now)
  const handledRef = useRef<number | null>(null)

  useEffect(() => {
    if (passed === null) return
    if (handledRef.current !== null && passed <= handledRef.current) return
    handledRef.current = passed
    refresh()
  }, [passed, refresh])

  return now
}
