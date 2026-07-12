#!/usr/bin/env node
/**
 * Fase 1b — Seed imediato de times + jogos do BSA 2026 (sem esperar o cron).
 *
 * Busca /competitions/BSA/matches?season=2026 na football-data.org e emite
 * sql/01b-seed-teams-matches.sql com EXATAMENTE as mesmas chaves de upsert do
 * syncFixtures de produção (teams: (external_id, provider); matches: idem), então o
 * cron de discovery reconcilia por cima sem duplicar nada.
 *
 * Liga: phase = stage ('REGULAR_SEASON'), round = matchday, sem pênaltis/group_name.
 * scored_at fica NULL — o próximo scoreUnprocessedMatches pontua os finalizados e
 * recalcula o leaderboard (números idênticos aos importados; serve de validação).
 *
 * Lê FOOTBALL_API_KEY de ../../api/.dev.vars (padrão de scripts/test-results-api.ts).
 * Rodar: node generate-seed-matches.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const COMPETITION_ID = '06baa1de-01c3-4e71-ac6e-a850fa690ec1'
const PROVIDER = 'football-data'

function loadDevVars(path) {
  const vars = {}
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, '')
  }
  return vars
}

const apiKey =
  process.env.FOOTBALL_API_KEY ?? loadDevVars(resolve(here, '../../api/.dev.vars')).FOOTBALL_API_KEY
if (!apiKey) {
  console.error('FOOTBALL_API_KEY não encontrada')
  process.exit(1)
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const qn = (v) => (v === null || v === undefined ? 'NULL' : q(v))

// slugify idêntico ao de api/src/matches/sync.ts
const slugify = (str) =>
  str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const mapStatus = (s) => (s === 'FINISHED' || s === 'AWARDED' ? 'finished' : 'scheduled')

const res = await fetch('https://api.football-data.org/v4/competitions/BSA/matches?season=2026', {
  headers: { 'X-Auth-Token': apiKey },
})
if (!res.ok) throw new Error(`football-data respondeu ${res.status}: ${await res.text()}`)
const data = await res.json()

const teams = new Map()
for (const m of data.matches) {
  for (const t of [m.homeTeam, m.awayTeam]) if (t?.id) teams.set(t.id, t)
}

const lines = [
  '-- Fase 1b — Seed de times + jogos do BSA 2026 (gerado por generate-seed-matches.mjs; não editar à mão).',
  '-- Idempotente e compatível com o upsert do syncFixtures (mesmas chaves de conflito).',
  '-- Aplicar com:',
  '--   npx wrangler d1 execute palpitae --remote --file docs/bolao-migration/sql/01b-seed-teams-matches.sql',
  '',
]

for (const t of teams.values()) {
  const shortName = t.tla ?? t.shortName ?? t.name.substring(0, 3).toUpperCase()
  lines.push(
    `INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)`,
    `VALUES (${q(randomUUID())}, ${q(t.name)}, ${q(shortName)}, ${q(slugify(t.name))}, ${qn(t.crest)}, ${q(t.id)}, ${q(PROVIDER)})`,
    `ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;`,
  )
}
lines.push('')

let finished = 0
for (const m of data.matches) {
  const status = mapStatus(m.status)
  if (status === 'finished') finished++
  const round = m.matchday !== null ? String(m.matchday) : m.stage
  lines.push(
    `INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)`,
    `SELECT ${q(randomUUID())}, ${q(COMPETITION_ID)}, ${q(m.id)}, ${q(PROVIDER)}, h.id, a.id, ${q(m.utcDate)}, ${q(status)}, ${m.score.fullTime.home ?? 'NULL'}, ${m.score.fullTime.away ?? 'NULL'}, ${qn(m.stage)}, ${q(round)}, NULL, ${qn(m.score.duration)}`,
    `FROM teams h, teams a`,
    `WHERE h.external_id = ${q(m.homeTeam.id)} AND h.provider = ${q(PROVIDER)}`,
    `  AND a.external_id = ${q(m.awayTeam.id)} AND a.provider = ${q(PROVIDER)}`,
    `ON CONFLICT (external_id, provider) DO NOTHING;`,
  )
}

writeFileSync(join(here, 'sql', '01b-seed-teams-matches.sql'), lines.join('\n') + '\n')
console.log(`times: ${teams.size} · jogos: ${data.matches.length} (${finished} finalizados)`)
