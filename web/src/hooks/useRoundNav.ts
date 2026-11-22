import type { Dispatch, SetStateAction } from 'react'
import { trackEvent } from '../analytics/ga'

export interface RoundNavEvents {
  prev: string
  next: string
}

/**
 * Navegação entre rodadas: avança ou volta um índice e registra o evento com a
 * rodada de destino. `index` já vem limitado pelo chamador. Com lista vazia, cada
 * tela escolhe o seu valor (a aba de palpites usa -1, o modal do ranking usa 0).
 */
export function useRoundNav(
  roundKeys: string[],
  index: number,
  setIndex: Dispatch<SetStateAction<number>>,
  events: RoundNavEvents,
) {
  function prev() {
    trackEvent(events.prev, {
      round: roundKeys[Math.max(0, index - 1)],
    })
    setIndex((i) => Math.max(0, i - 1))
  }

  function next() {
    trackEvent(events.next, {
      round: roundKeys[Math.min(roundKeys.length - 1, index + 1)],
    })
    setIndex((i) => Math.min(roundKeys.length - 1, i + 1))
  }

  return { prev, next }
}
