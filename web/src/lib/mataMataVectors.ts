/**
 * Formato dos vetores de ouro do mata-mata em `test-vectors/mata-mata.json`.
 * O mesmo arquivo é lido pelo teste do web e pelo da API.
 */
export type MataMataSide = 'home' | 'away'

export type MataMataScorePair = {
  home: number
  away: number
}

/** Papel no confronto; `null` = fora do mata-mata (sem `tie_role` no payload). */
export type MataMataRole = 'leg1' | 'leg2' | 'single' | null

export type MataMataVectorInput = {
  role: MataMataRole
  decidesOnPenalties: boolean
  home: number
  away: number
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
