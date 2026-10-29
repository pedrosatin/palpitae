import { formatSince } from './ProviderOpsSection'
import { OTHER_COLOR, SERIES_COLORS, StackedBarChart, type StackedDay } from './charts'
import { lastDays } from './dates'
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
 *
 * A série diária (`groupsDaily`) é opcional: uma API anterior à série devolve
 * só a tabela. Só traz dias com criação; os dias zerados são preenchidos aqui.
 */

export interface CompetitionActivityResponse {
  days: number
  predictionsDimensionSince: string | null
  groupsDaily?: { day: string; competition_id: string; groups_created: number }[]
  groupsDailyTruncated?: boolean
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

// Séries nomeadas além do top da paleta agrupam em "outros".
const MAX_SERIES = SERIES_COLORS.length
const OTHERS = 'outros'
const NO_LEAGUE = 'sem-liga'

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

const EMPTY_ROW = {
  competition_id: '',
  name: null,
  season: null,
  groups_created: 0,
  prediction_saves: 0,
  predictions: 0,
}

/**
 * Barras empilhadas de criações de grupo por dia, uma série por campeonato
 * (os de maior volume no período; o resto vira "outros"). Dia sem criação entra
 * zerado. Linhas fora dos `days` dias do eixo (o primeiro dia da janela é
 * parcial na consulta) não cabem no gráfico e voltam em `outsideAxis`.
 */
export function buildGroupsDailySeries(data: CompetitionActivityResponse) {
  const rows = data.groupsDaily ?? []
  const axis = lastDays(data.days)
  const inAxis = new Set(axis)

  const keyOf = (id: string) => id || NO_LEAGUE
  const totals = new Map<string, number>()
  let outsideAxis = 0
  for (const r of rows) {
    if (!inAxis.has(r.day)) {
      outsideAxis += r.groups_created
      continue
    }
    totals.set(
      keyOf(r.competition_id),
      (totals.get(keyOf(r.competition_id)) ?? 0) + r.groups_created,
    )
  }

  const ranked = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key)
  const top = ranked.slice(0, MAX_SERIES)
  const colorFor = new Map(top.map((key, i) => [key, SERIES_COLORS[i]]))
  const order = ranked.length > top.length ? [...top, OTHERS] : top

  const byDay = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if (!inAxis.has(r.day)) continue
    const key = colorFor.has(keyOf(r.competition_id)) ? keyOf(r.competition_id) : OTHERS
    const perKey = byDay.get(r.day) ?? new Map<string, number>()
    perKey.set(key, (perKey.get(key) ?? 0) + r.groups_created)
    byDay.set(r.day, perKey)
  }

  const days: StackedDay[] = axis.map((label) => ({
    label,
    segments: order
      .map((key) => ({
        type: key,
        // Sob sampling o peso é fracionário: dois decimais bastam pro tooltip.
        value: Math.round((byDay.get(label)?.get(key) ?? 0) * 100) / 100,
        color: colorFor.get(key) ?? OTHER_COLOR,
      }))
      .filter((seg) => seg.value > 0),
  }))
  const legend = order.map((key) => ({ key, color: colorFor.get(key) ?? OTHER_COLOR }))
  return { days, legend, outsideAxis: Math.round(outsideAxis * 100) / 100 }
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

function GroupsDailyChart({ data }: { data: CompetitionActivityResponse }) {
  if (!Array.isArray(data.groupsDaily)) {
    return (
      <p className={styles.hint}>
        Série diária indisponível: a API ainda não envia as criações de grupo por dia.
      </p>
    )
  }
  if (data.groupsDaily.length === 0) {
    return <p className={styles.hint}>Nenhuma criação de grupo no período.</p>
  }

  const { days, legend, outsideAxis } = buildGroupsDailySeries(data)
  const byId = new Map(data.competitions.map((c) => [c.competition_id, c]))
  const nameOf = (key: string): { text: string; title: string } => {
    if (key === OTHERS) return { text: 'Outros', title: 'Campeonatos de menor volume agrupados' }
    return rowName(
      byId.get(key === NO_LEAGUE ? '' : key) ?? {
        ...EMPTY_ROW,
        competition_id: key === NO_LEAGUE ? '' : key,
      },
    )
  }

  return (
    <>
      <h3 className={styles.subTitle}>Grupos criados por dia · últimos {data.days} dias</h3>
      <StackedBarChart
        days={days}
        ariaLabel="Grupos criados por dia, por campeonato"
        segmentLabel={(key) => nameOf(key).text}
      />
      <div className={styles.legend}>
        {legend.map((l) => (
          <span key={l.key} className={styles.legendItem} title={nameOf(l.key).title}>
            <span className={styles.legendDot} style={{ backgroundColor: l.color }} />
            {nameOf(l.key).text}
          </span>
        ))}
      </div>
      {data.groupsDailyTruncated && (
        <p className={styles.samplingWarning}>
          A consulta diária bateu no limite de linhas da API do Analytics Engine: os dias mais
          antigos do período podem estar incompletos no gráfico e em totais derivados da série.
        </p>
      )}
      {outsideAxis > 0 && (
        <p className={styles.hint}>
          {formatNumber(outsideAxis)} grupos criados no dia parcial do início do período entram na
          tabela, mas não no gráfico.
        </p>
      )}
    </>
  )
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
            <>
              <GroupsDailyChart data={data} />
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
            </>
          )}
        </>
      )}
    </section>
  )
}
