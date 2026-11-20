/**
 * Formato dos vetores de ouro do mata-mata em `test-vectors/mata-mata.json`.
 * O mesmo arquivo é lido pelo teste da API e pelo do web.
 */
export type MataMataSide = 'home' | 'away'

export type MataMataScorePair = {
  home: number
  away: number
}

/** Papel no confronto; `null` = fora do mata-mata (sem `tie_role` no web). */
export type MataMataRole = 'leg1' | 'leg2' | 'single' | null

export type MataMataVectorInput = {
  role: MataMataRole
  /**
   * Equivalente a `decides_on_penalties` / `eligible` de `penaltyPickNeeded`.
   * Na volta o produto usa `true`; na ida o card nunca pede pênalti (mesmo com
   * `true`, coberto por `ida-com-empate-ainda-nao-pede-penalti`).
   */
  decidesOnPenalties: boolean
  home: number
  away: number
  /**
   * Palpite da ida no referencial da ida.
   * Usado só quando `role` é `leg2`; `null` quando ausente.
   * Nos demais papéis o campo não entra no cálculo (pode vir preenchido só para
   * provar que a ida o ignora).
   */
  leg1: MataMataScorePair | null
  penaltyWinner: MataMataSide | null
}

export type MataMataVectorExpected = {
  predictedClassified: MataMataSide | null
  predictedTieScore: MataMataScorePair | null
  penaltyPickNeeded: boolean
}

export type MataMataVectorCase = {
  name: string
  input: MataMataVectorInput
  expected: MataMataVectorExpected
}

export type MataMataVectorsFile = {
  cases: MataMataVectorCase[]
}
