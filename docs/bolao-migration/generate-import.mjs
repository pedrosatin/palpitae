#!/usr/bin/env node
/**
 * Fase 3 — Gera o SQL de importação das predictions do bolão.
 *
 * Lê o dump read-only do D1 do bolão e produz sql/03-import-predictions.sql. O
 * match_id do Palpitae é resolvido em tempo de aplicação via subselect por
 * matches.external_id (= api_match_id do bolão), então o SQL só pode ser aplicado
 * DEPOIS que o sync popular os jogos do BSA.
 *
 * O dump real, o mapa de participantes e o SQL gerado têm dados pessoais e ficam
 * fora do repositório (ver .gitignore). Para rodar, crie localmente:
 *   - bolao-predictions-export.json: mesmo formato de
 *     bolao-predictions-export.example.json (dados sintéticos);
 *   - bolao-user-map.json: { "group_id": "<GROUP_ID>", "users": { "<participant_name>": "<users.id>" } }.
 *     Duas grafias do mesmo jogador apontam para o mesmo users.id.
 *
 * Sem os arquivos locais, o script usa o exemplo sintético e placeholders, o que
 * serve para conferir o formato do SQL.
 *
 * Idempotente: ON CONFLICT (user_id, group_id, match_id) DO NOTHING — reaplicar não
 * duplica nem sobrescreve.
 *
 * Rodar: node generate-import.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function readLocal(name, fallbackName) {
  const path = existsSync(join(here, name)) ? join(here, name) : join(here, fallbackName)
  return JSON.parse(readFileSync(path, 'utf-8'))
}

const EXAMPLE_MAP = {
  group_id: '<GROUP_ID>',
  users: {
    'Jogador A': '<USER_ID_A>',
    'Jogador B': '<USER_ID_B>',
    'Jogador B2': '<USER_ID_B>',
  },
}

const userMap = existsSync(join(here, 'bolao-user-map.json'))
  ? JSON.parse(readFileSync(join(here, 'bolao-user-map.json'), 'utf-8'))
  : EXAMPLE_MAP
const GROUP_ID = userMap.group_id
const USER_MAP = userMap.users

const dump = readLocal('bolao-predictions-export.json', 'bolao-predictions-export.example.json')
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
