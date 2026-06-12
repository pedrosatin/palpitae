/**
 * Script de exploração da football-data.org API.
 * Roda com: npx tsx scripts/test-results-api.ts
 *
 * Lê FOOTBALL_API_KEY do arquivo .dev.vars na raiz de /api.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

function loadDevVars(): Record<string, string> {
  const vars: Record<string, string> = {}
  try {
    const content = readFileSync(resolve(process.cwd(), '.dev.vars'), 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
  } catch {
    console.error('Não encontrei .dev.vars — defina FOOTBALL_API_KEY no ambiente')
  }
  return vars
}

const env = loadDevVars()
const API_KEY = process.env.FOOTBALL_API_KEY ?? env.FOOTBALL_API_KEY

if (!API_KEY) {
  console.error('FOOTBALL_API_KEY não encontrada')
  process.exit(1)
}

const BASE = 'https://api.football-data.org/v4'
const COMPETITION = 'WC'
const SEASON = 2026

async function fetchMatches(params: Record<string, string> = {}) {
  const url = new URL(`${BASE}/competitions/${COMPETITION}/matches`)
  url.searchParams.set('season', String(SEASON))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  console.log(`\n→ GET ${url.toString()}`)
  const res = await fetch(url.toString(), { headers: { 'X-Auth-Token': API_KEY } })
  console.log(`← HTTP ${res.status} ${res.statusText}`)

  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    console.log('Resposta não é JSON:', text.slice(0, 500))
    return null
  }

  return json
}

function summarizeMatches(data: unknown) {
  if (!data || typeof data !== 'object') return
  const d = data as Record<string, unknown>

  const matches = Array.isArray(d.matches) ? d.matches : []
  console.log(`\nTotal de partidas: ${matches.length}`)

  const byStatus: Record<string, number> = {}
  for (const m of matches) {
    const s = (m as Record<string, unknown>).status as string
    byStatus[s] = (byStatus[s] ?? 0) + 1
  }
  console.log('Por status:', byStatus)

  const finished = matches.filter((m) => {
    const s = (m as Record<string, unknown>).status as string
    return s === 'FINISHED' || s === 'AWARDED'
  })

  if (finished.length > 0) {
    console.log(`\n--- Partidas finalizadas (${finished.length}) ---`)
    for (const m of finished.slice(0, 5)) {
      const match = m as Record<string, unknown>
      const score = (match.score as Record<string, unknown>)?.fullTime as Record<string, unknown>
      const home = (match.homeTeam as Record<string, unknown>)?.shortName ?? (match.homeTeam as Record<string, unknown>)?.tla
      const away = (match.awayTeam as Record<string, unknown>)?.shortName ?? (match.awayTeam as Record<string, unknown>)?.tla
      console.log(
        `  [${match.id}] ${home} ${score?.home ?? '?'} x ${score?.away ?? '?'} ${away}` +
        `  | stage: ${match.stage} | matchday: ${match.matchday}` +
        `  | date: ${match.utcDate}`,
      )
    }
    if (finished.length > 5) console.log(`  ... e mais ${finished.length - 5}`)

    const sample = finished[0] as Record<string, unknown>
    console.log('\n--- Estrutura completa da primeira partida finalizada ---')
    console.log(JSON.stringify(sample, null, 2))
  } else {
    console.log('\nNenhuma partida finalizada ainda.')
    if (matches.length > 0) {
      console.log('\n--- Próxima partida agendada ---')
      console.log(JSON.stringify(matches[0], null, 2))
    }
  }
}

async function main() {
  console.log('=== Testando football-data.org ===')
  console.log(`Competição: ${COMPETITION} | Temporada: ${SEASON}`)

  // 1. Todas as partidas
  const all = await fetchMatches()
  summarizeMatches(all)

  // 2. Apenas finalizadas
  console.log('\n\n=== Filtrando status=FINISHED ===')
  const finished = await fetchMatches({ status: 'FINISHED' })
  summarizeMatches(finished)
}

main().catch(console.error)
