
import { writeFileSync } from 'node:fs'
import { SqlCollector } from '../src/radar/sqlCollector'
import { syncRadar } from '../src/radar/sync'

const outputPath = process.argv[2]
if (!outputPath) {
  console.error('Uso: tsx scripts/radarSync.ts <arquivo-de-saída.sql>')
  process.exit(1)
}

const collector = new SqlCollector()

// O mesmo syncRadar de sempre, sem alteração: o coletor implementa a fatia da
// interface do D1 que ele usa.
const result = await syncRadar(collector as never)

if (result.status === 'error' || collector.size === 0) {
  console.error('[radar] Nenhum statement gerado — coleta falhou.')
  process.exit(1)
}

writeFileSync(outputPath, collector.toSql(), 'utf8')
console.info(`[radar] ${collector.size} statements gravados em ${outputPath}`)

if (result.status === 'partial') {
  console.info(
    `::warning title=Radar parcial::${result.failedSlugs.length} slug(s) da ESPN sem resposta` +
      `${result.failedSlugs.length > 0 ? ` (${result.failedSlugs.join(', ')})` : ''}, ` +
      `${result.pageviewErrors} artigo(s) sem pageviews. Os itens afetados mantêm o snapshot anterior.`,
  )
}
