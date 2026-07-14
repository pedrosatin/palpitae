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
const GROUP_ID = 'd79438a7-a324-48d0-a245-950aff4d5849'

// participant_name do bolão → users.id do Palpitae (WEEGEE/WEEGGE = mesma pessoa)
const USER_MAP = {
  satin: '7c13016e-5ae7-4e35-acc2-f6115dc94c1c',
  Chu: '69478023-3b14-480f-b999-adc02c99816a',
  FABRE: 'e1072bec-d62d-439f-9e49-31ea92c02ce4',
  PDR: 'd34b5d2e-00ee-4802-bff4-2272b03380e9',
  WEEGEE: '482b2145-dc50-4a8e-8e15-293ea6af4e60',
  WEEGGE: '482b2145-dc50-4a8e-8e15-293ea6af4e60',
  Isa: '15473f3c-bb85-4315-9c13-4e716746a47d',
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
