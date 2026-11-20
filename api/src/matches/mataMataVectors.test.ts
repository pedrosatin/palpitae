import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { penaltyPickNeeded } from '../predictions/penaltyPick'
import type { TieRole } from './ties'
import {
  resolveSingleMatchClassified,
  resolveTwoLegClassified,
} from './scoring'
import type {
  MataMataScorePair,
  MataMataVectorCase,
  MataMataVectorExpected,
  MataMataVectorInput,
  MataMataVectorsFile,
} from './mataMataVectors'

const vectorsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../test-vectors/mata-mata.json',
)

const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8')) as MataMataVectorsFile

function leg1Score(leg1: MataMataScorePair | null) {
  return leg1 ? { homeScore: leg1.home, awayScore: leg1.away } : null
}

/** Agregado da volta no referencial do jogo de volta (mandante da volta = visitante da ida). */
function predictedTieScoreFromApi(input: MataMataVectorInput): MataMataScorePair | null {
  const { role, home, away, leg1 } = input
  if (role === 'leg2') {
    if (!leg1) return null
    return { home: home + leg1.away, away: away + leg1.home }
  }
  return { home, away }
}

function predictedClassifiedFromApi(input: MataMataVectorInput): MataMataVectorExpected['predictedClassified'] {
  const { role, home, away, leg1, penaltyWinner } = input
  if (role === null || role === 'leg1') return null
  if (role === 'leg2') {
    if (!leg1) return null
    return resolveTwoLegClassified(leg1Score(leg1)!, {
      homeScore: home,
      awayScore: away,
      penaltyWinner,
    })
  }
  return resolveSingleMatchClassified(home, away, penaltyWinner)
}

function apiOutputs(input: MataMataVectorInput): MataMataVectorExpected {
  const role: TieRole = input.role ?? 'single'
  return {
    predictedClassified: predictedClassifiedFromApi(input),
    predictedTieScore: predictedTieScoreFromApi(input),
    penaltyPickNeeded: penaltyPickNeeded({
      eligible: input.decidesOnPenalties,
      role,
      home: input.home,
      away: input.away,
      leg1Score: leg1Score(input.leg1),
    }),
  }
}

describe('vetores de ouro do mata-mata (API)', () => {
  it('carrega pelo menos os casos do ticket', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(8)
  })

  it.each(vectors.cases.map((c: MataMataVectorCase) => [c.name, c] as const))(
    '%s',
    (_name, vectorCase) => {
      expect(apiOutputs(vectorCase.input)).toEqual(vectorCase.expected)
    },
  )
})
