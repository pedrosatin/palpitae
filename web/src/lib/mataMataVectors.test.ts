import { describe, expect, it } from 'vitest'
import { makeMatch } from '../components/matchFixtures'
import type { Prediction } from '../components/MatchCard'
import {
  needsPenaltyPick,
  predictedClassified,
  predictedTieScore,
} from './predictedTie'
import type {
  MataMataVectorCase,
  MataMataVectorExpected,
  MataMataVectorInput,
  MataMataVectorsFile,
} from './mataMataVectors'

// O pacote web não declara @types/node (type-check do CI roda só em web/).
// O Vitest resolve `node:fs` em runtime; o JSON fica na raiz do monorepo.
// @ts-expect-error — sem @types/node no tsconfig do web
import { readFileSync } from 'node:fs'
// @ts-expect-error — sem @types/node no tsconfig do web
import { dirname, join } from 'node:path'
// @ts-expect-error — sem @types/node no tsconfig do web
import { fileURLToPath } from 'node:url'

const vectorsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../test-vectors/mata-mata.json',
)

const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8')) as MataMataVectorsFile

function webOutputs(input: MataMataVectorInput): MataMataVectorExpected {
  const match = makeMatch({
    ...(input.role === null ? {} : { tie_role: input.role }),
    decides_on_penalties: input.decidesOnPenalties,
  })
  const leg1 = input.leg1
    ? ({
        predicted_home_score: input.leg1.home,
        predicted_away_score: input.leg1.away,
      } as Prediction)
    : undefined

  return {
    predictedClassified: predictedClassified(
      match,
      input.home,
      input.away,
      input.penaltyWinner,
      leg1,
    ),
    predictedTieScore: predictedTieScore(match, input.home, input.away, leg1),
    penaltyPickNeeded: needsPenaltyPick(match, input.home, input.away, leg1),
  }
}

describe('vetores de ouro do mata-mata (web)', () => {
  it('carrega pelo menos os casos do ticket', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(8)
  })

  it('usa nomes únicos em cada caso', () => {
    const names = vectors.cases.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it.each(vectors.cases.map((c: MataMataVectorCase) => [c.name, c] as const))(
    '%s',
    (_name, vectorCase) => {
      expect(webOutputs(vectorCase.input)).toEqual(vectorCase.expected)
    },
  )
})
