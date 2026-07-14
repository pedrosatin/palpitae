#!/usr/bin/env node
/**
 * Fase 3 — Gera o SQL de importação das predictions do bolão.
 *
 * Lê bolao-predictions-export.json (dump read-only do D1 do bolão) e produz
 * sql/03-import-predictions.sql. O match_id do Palpitae é resolvido em tempo de
 * aplicação via subselect por matches.external_id (= api_match_id do bolão), então o
 * SQL só pode ser aplicado DEPOIS que o sync popular os jogos do BSA.
 *
 * Idempotente: ON CONFLICT (user_id, group_id, match_id) DO NOTHING — reaplicar não
 * duplica nem sobrescreve.
 *
 * Rodar: node generate-import.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const GROUP_ID = '<GROUP_ID>'

// participant_name do bolão → users.id do Palpitae (WEEGEE/WEEGGE = mesma pessoa)
const USER_MAP = {
  satin: '<USER_ID_A>',
  Chu: '<USER_ID_B>',
  FABRE: '<USER_ID_C>',
  PDR: '<USER_ID_D>',
  WEEGEE: '<USER_ID_E>',
  WEEGGE: '<USER_ID_E>',
  Isa: '<USER_ID_F>',
}

const dump = JSON.parse(readFileSync(join(here, 'bolao-predictions-export.json'), 'utf-8'))
const rows = dump[0].results

const lines = [
  '-- Fase 3 — Import das predictions do bolão (gerado por generate-import.mjs; não editar à mão).',
  '-- Pré-requisitos: Fases 1 e 2 aplicadas E jogos do BSA sincronizados (cron de discovery).',
  '-- Aplicar com:',
  '--   npx wrangler d1 execute palpitae --remote --file docs/bolao-migration/sql/03-import-predictions.sql',
  '',
]

let skipped = 0
const perUser = {}
for (const r of rows) {
  const userId = USER_MAP[r.name]
  if (!userId) {
    skipped++
    console.error(`participante sem mapeamento: ${r.name}`)
    continue
  }
  perUser[userId] = (perUser[userId] ?? 0) + 1
  lines.push(
    `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)`,
    `SELECT '${randomUUID()}', '${userId}', '${GROUP_ID}', m.id, ${r.ph}, ${r.pa}, ${r.pts}, 0, '${r.ca}', '${r.ua}'`,
    `FROM matches m WHERE m.external_id = '${r.ext}' AND m.provider = 'football-data'`,
    `ON CONFLICT (user_id, group_id, match_id) DO NOTHING;`,
  )
}

writeFileSync(join(here, 'sql', '03-import-predictions.sql'), lines.join('\n') + '\n')
console.log(`geradas ${rows.length - skipped} inserções (${skipped} puladas)`)
console.log('por usuário:', perUser)
