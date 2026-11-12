/**
 * Placar das linhas de `matches` gravadas direto nos testes. A migration 0043
 * recusa jogo `finished` sem placar, então o fixture que só precisa de um jogo
 * encerrado grava 1x0; os demais status ficam sem placar.
 */
export function finalScore(status: string): [number, number] | [null, null] {
  return status === 'finished' ? [1, 0] : [null, null]
}
