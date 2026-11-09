import { CollectionNotice, formatCount } from './InviteFunnelSection'
import styles from './AdminMetricsPage.module.css'

/**
 * Cadastros por origem no período. Consome GET /metrics/signup-origins: eventos do
 * Analytics Engine com o total do D1 ao lado. A diferença aparece em linha própria,
 * sem ser encaixada numa categoria, porque é ela que mostra se a medição fecha.
 */

type OriginKey = 'convite' | 'guia' | 'busca' | 'direto' | 'desconhecida'

export interface SignupOriginsResponse {
  days: number
  origins: Record<OriginKey, number>
  guides: { slug: string; signups: number }[]
  totalEvents: number
  d1: { signups: number }
  originsSince: string | null
  avgSampleInterval: number
}

const ORIGIN_ROWS: { key: OriginKey; label: string }[] = [
  { key: 'convite', label: 'convite' },
  { key: 'guia', label: 'guia' },
  { key: 'busca', label: 'busca' },
  { key: 'direto', label: 'direto' },
  { key: 'desconhecida', label: 'desconhecida' },
]

function isSignupOrigins(data: SignupOriginsResponse | null): data is SignupOriginsResponse {
  return !!data && typeof data.totalEvents === 'number' && !!data.d1 && !!data.origins
}

function share(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : '—'
}

function guideLabel(slug: string): string {
  return slug || 'índice dos guias'
}

export default function SignupOriginsSection({ data }: { data: SignupOriginsResponse | null }) {
  if (!isSignupOrigins(data)) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Cadastros por origem</h2>
        <p className={styles.hint}>Indisponível: a API ainda não envia a origem dos cadastros.</p>
      </section>
    )
  }

  const estimated = data.avgSampleInterval > 1.01
  const events = (n: number) => `${estimated ? '≈ ' : ''}${formatCount(n)}`
  const difference = Math.round(data.d1.signups - data.totalEvents)

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Cadastros por origem · últimos {data.days} dias</h2>
      <CollectionNotice subject="Origem dos cadastros" since={data.originsSince} days={data.days} />
      {estimated && (
        <p className={styles.samplingWarning}>
          Analytics Engine amostrando: as contagens de eventos desta seção são estimativas.
        </p>
      )}
      <div className={styles.tableScroll}>
        <table className={styles.table} aria-label="Cadastros por origem">
          <thead>
            <tr>
              <th>origem</th>
              <th className={styles.num}>cadastros</th>
              <th className={styles.num}>% do total</th>
            </tr>
          </thead>
          <tbody>
            {ORIGIN_ROWS.map(({ key, label }) => (
              <tr key={key}>
                <td>{label}</td>
                <td className={styles.num}>{events(data.origins[key])}</td>
                <td className={styles.num}>{share(data.origins[key], data.totalEvents)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>soma das origens</strong>
              </td>
              <td className={styles.num}>
                <strong>{events(data.totalEvents)}</strong>
              </td>
              <td className={styles.num}>—</td>
            </tr>
            <tr>
              <td>contas criadas no D1</td>
              <td className={styles.num}>{formatCount(data.d1.signups)}</td>
              <td className={styles.num}>—</td>
            </tr>
            {difference !== 0 && (
              <tr>
                <td>diferença (D1 menos eventos)</td>
                <td className={styles.num}>{difference.toLocaleString('pt-BR')}</td>
                <td className={styles.num}>—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data.guides.length > 0 && (
        <p className={styles.hint}>
          Por guia:{' '}
          {data.guides.map((g) => `${guideLabel(g.slug)} (${events(g.signups)})`).join(' · ')}
        </p>
      )}
      <p className={styles.hint}>
        Soma e D1 fecham quando a coleta cobre o período. Conta anterior à coleta fica só no D1; sob
        amostragem os eventos são estimativa.
      </p>
    </section>
  )
}
