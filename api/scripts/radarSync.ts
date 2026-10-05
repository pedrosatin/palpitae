/**
 * Coleta do radar de competições, fora do Worker.
 *
 * Roda no GitHub Actions (ver `.github/workflows/radar-sync.yml`) por escolha
 * de arquitetura: o modelo "script gera SQL + wrangler aplica" mantém as
 * credenciais separadas — quem escreve no D1 é só o wrangler, com o token que
 * o CI já usa para deploy e migrações. O provedor da coleta (ESPN) não tem
 * chave nem política por IP, então nada impede que um dia volte a rodar dentro
 * do Worker; o motivo original (rate limit por IP da API-Football, ADR-014)
 * deixou de existir com a troca de provedor (ADR-015).
 *
 * Não escreve no banco: gera o `.sql` que o workflow aplica com
 * `wrangler d1 execute --remote --file`.
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

const collector = new SqlCollector()

// O mesmo syncRadar de sempre, sem alteração: o coletor implementa a fatia da
// interface do D1 que ele usa.
await syncRadar(collector as never)

if (collector.size === 0) {
  // Sem statements = a coleta falhou (a própria syncRadar já logou o motivo).
  // Falhar aqui é o que faz o workflow ficar vermelho em vez de aplicar um
  // arquivo vazio e fingir sucesso.
  console.error('[radar] Nenhum statement gerado — coleta falhou.')
  process.exit(1)
}

writeFileSync(outputPath, collector.toSql(), 'utf8')
console.info(`[radar] ${collector.size} statements gravados em ${outputPath}`)
