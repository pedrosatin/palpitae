import { useEffect, useState } from 'react'

/**
 * Hora atual em ms, renovada a cada `intervalMs`. Serve a textos que mudam com o
 * relógio, como o "fecha em 2 h 15 min" do cabeçalho da rodada.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
