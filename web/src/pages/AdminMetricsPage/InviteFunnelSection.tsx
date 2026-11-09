import { formatSince } from './ProviderOpsSection'
import styles from './AdminMetricsPage.module.css'

/**
 * Funil de convite no período. Consome GET /metrics/invite-funnel: aberturas e
 * entradas do Analytics Engine, com a contagem do D1 ao lado para conferência.
 *
 * Aberturas, método e cadastro recente só existem a partir do deploy da medição.
 * A página avisa enquanto a coleta for mais nova que o período, porque essa falta
 * de dado não é zero. Sob sampling do Analytics Engine as contagens são estimativas.
 */

export interface InviteFunnelResponse {
  days: number
  opens: number
  joins: number
  joinsByMethod: { convite_link: number; codigo: number; unknown: number }
  newMembers: number
  existingMembers: number
  unclassifiedJoins: number
  d1: { joins: number; newMembers: number; existingMembers: number }
  opensSince: string | null
  joinDimensionSince: string | null
  avgSampleInterval: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function formatCount(n: number): string {
  return Math.round(n).toLocaleString('pt-BR')
}

/** Só as entradas por link passam pela página de convite: entram na taxa. */
function linkConversion(data: InviteFunnelResponse): string {
  if (data.opens <= 0) return '—'
  return `${Math.round((data.joinsByMethod.convite_link / data.opens) * 100)}%`
}

function isNewerThanPeriod(ts: string, days: number): boolean {
  const first = new Date(`${ts.replace(' ', 'T')}Z`).getTime()
  return Number.isFinite(first) && first > Date.now() - days * DAY_MS
}

function CollectionNotice({
  subject,
  since,
  days,
}: {
  subject: string
  since: string | null
  days: number
}) {
  if (!since) {
    return (
      <p className={styles.samplingWarning}>
        {subject}: nenhum registro ainda. A coleta é recente ou o deploy não chegou ao Worker. Isso
        é falta de dado, não zero.
      </p>
    )
  }
  if (isNewerThanPeriod(since, days)) {
    return (
      <p className={styles.samplingWarning}>
        {subject}: a coleta começou em {formatSince(since)}; antes disso não há dados.
      </p>
    )
  }
  return null
}

function isInviteFunnel(data: InviteFunnelResponse | null): data is InviteFunnelResponse {
  return !!data && typeof data.opens === 'number' && !!data.d1 && !!data.joinsByMethod
}

export default function InviteFunnelSection({ data }: { data: InviteFunnelResponse | null }) {
  if (!isInviteFunnel(data)) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Funil de convite</h2>
        <p className={styles.hint}>Indisponível: a API ainda não envia o funil de convite.</p>
      </section>
    )
  }

  const estimated = data.avgSampleInterval > 1.01
  const events = (n: number) => `${estimated ? '≈ ' : ''}${formatCount(n)}`
  const { convite_link: byLink, codigo: byCode, unknown } = data.joinsByMethod

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Funil de convite · últimos {data.days} dias</h2>
      <CollectionNotice subject="Aberturas" since={data.opensSince} days={data.days} />
      <CollectionNotice
        subject="Método e cadastro recente das entradas"
        since={data.joinDimensionSince}
        days={data.days}
      />
      {estimated && (
        <p className={styles.samplingWarning}>
          Analytics Engine amostrando: as contagens de eventos deste funil são estimativas.
        </p>
      )}
      <div className={styles.tableScroll}>
        <table className={styles.table} aria-label="Funil de convite">
          <thead>
            <tr>
              <th>etapa</th>
              <th className={styles.num}>eventos</th>
              <th className={styles.num}>D1</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>aberturas do convite</td>
              <td className={styles.num}>{events(data.opens)}</td>
              <td className={styles.num}>—</td>
            </tr>
            <tr>
              <td>entradas em grupo</td>
              <td className={styles.num}>{events(data.joins)}</td>
              <td className={styles.num}>{formatCount(data.d1.joins)}</td>
            </tr>
            <tr>
              <td>convidados novos</td>
              <td className={styles.num}>{events(data.newMembers)}</td>
              <td className={styles.num}>{formatCount(data.d1.newMembers)}</td>
            </tr>
            <tr>
              <td>convidados que já tinham conta</td>
              <td className={styles.num}>{events(data.existingMembers)}</td>
              <td className={styles.num}>{formatCount(data.d1.existingMembers)}</td>
            </tr>
            {data.unclassifiedJoins > 0 && (
              <tr>
                <td>entradas sem classificação</td>
                <td className={styles.num}>{events(data.unclassifiedJoins)}</td>
                <td className={styles.num}>—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className={styles.hint}>
        Taxa aberturas → entradas por link: <strong>{linkConversion(data)}</strong> · por link:{' '}
        {events(byLink)} · por código: {events(byCode)}
        {unknown > 0 && ` · sem método: ${events(unknown)}`}
      </p>
      <p className={styles.hint}>
        Novo = conta criada menos de 1 h antes de entrar. O D1 só tem quem continua no grupo, então
        fica abaixo dos eventos quando alguém saiu ou foi removido depois de entrar.
      </p>
    </section>
  )
}
