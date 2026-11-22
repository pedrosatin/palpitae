/**
 * Formato dos vetores de ouro da cópia de palpites em `test-vectors/copia.json`.
 * O mesmo arquivo é lido pelo teste do web e pelo da API.
 */

export type CopiaAcceptsInput = {
  sourcePointsExact: number
  targetPointsExact: number
}

export type CopiaAcceptsCase = {
  name: string
  input: CopiaAcceptsInput
  expected: { accepts: boolean }
}

export type CopiaScoreInput = {
  targetPointsExact: number
  home: number
  away: number
}

export type CopiaScoreCase = {
  name: string
  input: CopiaScoreInput
  expected: { home: number; away: number }
}

export type CopiaVectorsFile = {
  accepts: CopiaAcceptsCase[]
  scores: CopiaScoreCase[]
}
