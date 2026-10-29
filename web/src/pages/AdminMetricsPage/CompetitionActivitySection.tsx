import { formatSince } from './ProviderOpsSection'
import styles from './AdminMetricsPage.module.css'

/**
 * Criações de grupo e palpites por campeonato no período. Consome
 * GET /metrics/competition-activity (Analytics Engine; nome e temporada já
 * resolvidos pelo Worker no D1).
 *
 * Duas ressalvas guiam a leitura:
 * - `competition_id` só existe em `prediction_saved` gravado depois do deploy
 *   do enriquecimento e não há backfill: o resto do período cai em "sem liga";
 * - sob sampling do Analytics Engine as contagens são estimativas.
 */

export interface CompetitionActivityResponse {
  days: number
  predictionsDimensionSince: string | null
  competitions: {
    competition_id: string
    name: string | null
    season: string | null
    groups_created: number
    prediction_saves: number
    predictions: number
  }[]
}

const DAY_MS = 24 * 60 * 60 * 1000

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('pt-BR')
}

function rowName(row: CompetitionActivityResponse['competitions'][number]): {
  text: string
  title: string
} {
  if (!row.competition_id) {
    return {
      text: 'sem liga',
      title: 'Evento gravado sem a dimensão de campeonato',
    }
  }
  if (!row.name) {
    return {
      text: `Campeonato ${row.competition_id.slice(0, 8)}`,
      title: row.competition_id,
    }
  }
  return {
    text: row.season ? `${row.name} ${row.season}` : row.name,
    title: row.competition_id,
  }
}

/** Avisa quando a dimensão não cobre o período inteiro (ausência ≠ zero). */
function DimensionNotice({ data }: { data: CompetitionActivityResponse }) {
  if (!data.predictionsDimensionSince) {
    return (
      <p className={styles.samplingWarning}>
        Nenhum palpite com campeonato foi registrado ainda: a coleta é recente ou o deploy não
        chegou ao Worker. Os palpites do período aparecem em &quot;sem liga&quot;, e isso é falta de
        dado, não ausência de atividade.
      </p>
    )
  }
  const first = new Date(`${data.predictionsDimensionSince.replace(' ', 'T')}Z`).getTime()
  if (Number.isFinite(first) && first > Date.now() - data.days * DAY_MS) {
    return (
      <p className={styles.samplingWarning}>
        O campeonato nos palpites começou a ser gravado em{' '}
        {formatSince(data.predictionsDimensionSince)}; os palpites anteriores ficam em &quot;sem
        liga&quot; (sem backfill).
      </p>
    )
  }
  return null
}

function isUsable(data: CompetitionActivityResponse | null): data is CompetitionActivityResponse {
  return !!data && Array.isArray(data.competitions)
}

export default function CompetitionActivitySection({
  data,
}: {
  data: CompetitionActivityResponse | null
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Atividade por campeonato</h2>
      {!isUsable(data) ? (
        <p className={styles.hint}>
          Indisponível: a API não enviou a atividade por campeonato (deploy pendente ou falha na
          consulta). Isso não significa zero atividade.
        </p>
      ) : (
        <>
          <p className={styles.hint}>
            Grupos criados e palpites salvos no período, por campeonato. Contagens do Analytics
            Engine ponderadas pelo sampling: viram estimativa se ele estiver amostrando.
          </p>
          <DimensionNotice data={data} />
          {data.competitions.length === 0 ? (
            <p className={styles.hint}>Nenhuma criação de grupo nem palpite no período.</p>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.table} aria-label="Atividade por campeonato">
                <thead>
                  <tr>
                    <th>campeonato</th>
                    <th className={styles.num}>grupos criados</th>
                    <th className={styles.num}>palpites salvos</th>
                    <th className={styles.num}>envios de palpites</th>
                  </tr>
                </thead>
                <tbody>
                  {data.competitions.map((row) => {
                    const name = rowName(row)
                    return (
                      <tr key={row.competition_id || 'sem-liga'}>
                        <td title={name.title}>{name.text}</td>
                        <td className={styles.num}>{formatNumber(row.groups_created)}</td>
                        <td className={styles.num}>{formatNumber(row.predictions)}</td>
                        <td className={styles.num}>{formatNumber(row.prediction_saves)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
