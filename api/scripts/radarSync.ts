/**
 * Coleta do radar de competições, fora do Worker.
 *
 * Roda no GitHub Actions (ver `.github/workflows/radar-sync.yml`) porque a
 * API-Football aplica rate limit por IP e os IPs de saída dos Cloudflare
 * Workers são compartilhados — do Worker a primeira chamada do dia já volta
 * 429 com a quota intacta. Ver ADR-014.
 *
 * Não escreve no banco: gera o `.sql` que o workflow aplica com
 * `wrangler d1 execute --remote --file`. Assim a única credencial que este
 * script precisa é a da API-Football; o acesso ao D1 continua sendo do
 * wrangler, com o token que o CI já usa para deploy e migrações.
 *
 * Uso: tsx scripts/radarSync.ts <arquivo-de-saída.sql>
 */

import { writeFileSync } from 'node:fs'
import { SqlCollector } from '../src/radar/sqlCollector'
import { syncRadar } from '../src/radar/sync'

const outputPath = process.argv[2]
if (!outputPath) {
  console.error('Uso: tsx scripts/radarSync.ts <arquivo-de-saída.sql>')
  process.exit(1)
}

const apiKey = process.env.API_FOOTBALL_KEY
if (!apiKey) {
  console.error('API_FOOTBALL_KEY não definida.')
  process.exit(1)
}

const collector = new SqlCollector()

// O mesmo syncRadar que rodava no cron do Worker, sem alteração: o coletor
// implementa a fatia da interface do D1 que ele usa.
await syncRadar(collector as never, apiKey)

if (collector.size === 0) {
  // Sem statements = a coleta falhou (a própria syncRadar já logou o motivo).
  // Falhar aqui é o que faz o workflow ficar vermelho em vez de aplicar um
  // arquivo vazio e fingir sucesso.
  console.error('[radar] Nenhum statement gerado — coleta falhou.')
  process.exit(1)
}

writeFileSync(outputPath, collector.toSql(), 'utf8')
console.info(`[radar] ${collector.size} statements gravados em ${outputPath}`)
