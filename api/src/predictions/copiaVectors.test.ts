import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type {
  CopiaAcceptsCase,
  CopiaScoreCase,
  CopiaVectorsFile,
} from './copiaVectors'
import { acceptsFrom, outcomeScore, type CopyGroup } from './replicate'

const vectorsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../test-vectors/copia.json',
)

const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8')) as CopiaVectorsFile

function group(pointsExact: number): CopyGroup {
  return { id: 'g', competition_id: 'c', points_exact: pointsExact }
}

function scoreForTarget(targetPointsExact: number, home: number, away: number) {
  return targetPointsExact === 0 ? outcomeScore(home, away) : { home, away }
}

describe('vetores de ouro da cópia (API)', () => {
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
      expect(acceptsFrom(group(sourcePointsExact), group(targetPointsExact))).toBe(
        vectorCase.expected.accepts,
      )
    },
  )

  it.each(vectors.scores.map((c: CopiaScoreCase) => [c.name, c] as const))(
    'placar no destino: %s',
    (_name, vectorCase) => {
      const { targetPointsExact, home, away } = vectorCase.input
      expect(scoreForTarget(targetPointsExact, home, away)).toEqual(vectorCase.expected)
    },
  )
})
