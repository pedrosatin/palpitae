import { useEffect, useRef } from 'react'
import { useNow } from '../../../hooks/useNow'
import {
  lastPassedBoundary,
  statusBoundaries,
  type RoundStatusFields,
} from '../../../lib/dashboardStatus'

/** Renova os horários curtos ("hoje 18:30") sem esperar um início de jogo. */
const TICK_MS = 60_000
/** Folga depois do horário: menor e maior. Espalha os painéis abertos no tempo. */
export const REFRESH_DELAY_MIN_MS = 3_000
export const REFRESH_DELAY_MAX_MS = 10_000
/** Espera da segunda tentativa, quando a resposta ainda traz o horário passado. */
export const REFRESH_RETRY_MS = 30_000

function refreshDelay(): number {
  return REFRESH_DELAY_MIN_MS + Math.random() * (REFRESH_DELAY_MAX_MS - REFRESH_DELAY_MIN_MS)
}

/**
 * Hora do painel. Quando ela passa um horário de `statusBoundaries`, os números
 * do `GET /groups` ficaram velhos e `refresh` busca a lista de novo.
 *
 * A busca sai de 3 a 10 s depois do horário, num atraso sorteado, e os painéis
 * abertos não chegam juntos à API. Se o relógio do aparelho estiver adiantado,
 * a resposta pode trazer o mesmo horário, ainda futuro para a API. Nesse caso
 * há uma segunda tentativa 30 s depois, uma só por horário.
 *
 * Horário que já chega passado na lista, sem a tela ter visto ele no futuro,
 * ganha uma busca só, sem a segunda tentativa: é resposta de cache ou relógio
 * adiantado, e repetir não muda nada.
 */
export function useStatusClock(
  groups: RoundStatusFields[],
  refresh: () => Promise<RoundStatusFields[] | null>,
): number {
  const boundaries = statusBoundaries(groups)
  const now = useNow(TICK_MS, boundaries)
  const passed = lastPassedBoundary(boundaries, now)
  const handledRef = useRef<number | null>(null)
  // Horários que estavam no futuro na renderização anterior.
  const futureRef = useRef<Set<number>>(new Set())
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  useEffect(() => {
    if (passed === null) return
    if (handledRef.current !== null && passed <= handledRef.current) return
    handledRef.current = passed
    const timers = timersRef.current

    const later = (run: () => void, delay: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        run()
      }, delay)
      timers.add(timer)
    }
    const attempt = (retries: number) => {
      void refreshRef.current().then((fresh) => {
        if (!fresh || retries === 0) return
        if (lastPassedBoundary(statusBoundaries(fresh), Date.now()) !== passed) return
        later(() => attempt(retries - 1), REFRESH_RETRY_MS)
      })
    }
    // Visto no futuro e cruzado com a tela aberta: cabe a segunda tentativa.
    const retries = futureRef.current.has(passed) ? 1 : 0
    later(() => attempt(retries), refreshDelay())
  }, [passed])

  useEffect(() => {
    futureRef.current = new Set(
      boundaries.map((boundary) => Date.parse(boundary)).filter((at) => at > now),
    )
  })

  return now
}
