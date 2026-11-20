import { describe, expect, it } from 'vitest'
import {
  acceptsFrom,
  outcomeScore,
  scoreForTarget,
} from './predictionCopy'
import type {
  CopiaAcceptsCase,
  CopiaScoreCase,
  CopiaVectorsFile,
} from './copiaVectors'

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
  '../../../test-vectors/copia.json',
)

const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8')) as CopiaVectorsFile

describe('vetores de ouro da cópia (web)', () => {
  it('carrega as quatro combinações de modo e os placares do ticket', () => {
    expect(vectors.accepts.length).toBe(4)
    expect(vectors.scores.length).toBeGreaterThanOrEqual(3)
  })

  it('usa nomes únicos em cada caso', () => {
    const names = [...vectors.accepts, ...vectors.scores].map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it.each(vectors.accepts.map((c: CopiaAcceptsCase) => [c.name, c] as const))(
    'acceptsFrom: %s',
    (_name, vectorCase) => {
      const { sourcePointsExact, targetPointsExact } = vectorCase.input
      expect(
        acceptsFrom(
          { points_exact: sourcePointsExact },
          { points_exact: targetPointsExact },
        ),
      ).toBe(vectorCase.expected.accepts)
    },
  )

  it.each(vectors.scores.map((c: CopiaScoreCase) => [c.name, c] as const))(
    'placar no destino: %s',
    (_name, vectorCase) => {
      const { targetPointsExact, home, away } = vectorCase.input
      expect(scoreForTarget({ points_exact: targetPointsExact }, home, away)).toEqual(
        vectorCase.expected,
      )
    },
  )

  it('outcomeScore reduz vitória, empate e derrota', () => {
    expect(outcomeScore(3, 1)).toEqual({ home: 1, away: 0 })
    expect(outcomeScore(2, 2)).toEqual({ home: 0, away: 0 })
    expect(outcomeScore(0, 4)).toEqual({ home: 0, away: 1 })
  })
})
