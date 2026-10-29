import { useState } from 'react'
import shared from '../admin-shared.module.css'
import { SERIES_COLORS } from './charts'
import styles from './AdminMetricsPage.module.css'

/**
 * Mapa de calor dia da semana × hora de palpites e logins, em horário de
 * Brasília. Consome GET /metrics/heatmap (Analytics Engine), que devolve uma
 * linha por hora UTC; a grade 7×24 e a conversão de fuso são daqui.
 *
 * Três ressalvas guiam a leitura:
 * - BRT é UTC−3 fixo (o Brasil não tem horário de verão desde 2019). A
 *   conversão pode mudar o dia: 01h UTC de segunda é 22h de domingo em BRT;
 * - a célula soma todas as ocorrências daquele dia da semana e hora no
 *   período. Com 30 ou 90 dias alguns dias da semana aparecem uma vez a mais,
 *   então diferenças pequenas entre dias não são sinal de comportamento;
 * - sob sampling do Analytics Engine as contagens são estimativas, e a falta
 *   de coleta fica sem dado em vez de virar zero.
 */

export interface HeatmapResponse {
  days: number
  avgSampleInterval: number
  firstSeenAt: { prediction_saved: string | null; login_success: string | null }
  hourly: { hour: string; prediction_saves: number; predictions: number; logins: number }[]
}

export type HeatmapMeasure = 'predictions' | 'saves' | 'logins'

export interface HeatmapGrid {
  /** `cells[diaDaSemana][hora]`, com domingo = 0, no fuso de Brasília. */
  cells: number[][]
  total: number
  max: number
  peak: { weekday: number; hour: number; value: number } | null
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const BRT_OFFSET_MS = 3 * HOUR_MS

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const WEEKDAYS_LONG = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
]
const HOURS = Array.from({ length: 24 }, (_, h) => h)

const MEASURES: {
  value: HeatmapMeasure
  label: string
  /** Substantivo para frases e tooltips. */
  noun: string
  field: 'predictions' | 'prediction_saves' | 'logins'
  event: 'prediction_saved' | 'login_success'
  color: string
}[] = [
  {
    value: 'predictions',
    label: 'Palpites salvos',
    noun: 'palpites salvos',
    field: 'predictions',
    event: 'prediction_saved',
    color: SERIES_COLORS[0],
  },
  {
    value: 'saves',
    label: 'Envios de palpites',
    noun: 'envios de palpites',
    field: 'prediction_saves',
    event: 'prediction_saved',
    color: SERIES_COLORS[0],
  },
  {
    value: 'logins',
    label: 'Logins',
    noun: 'logins',
    field: 'logins',
    event: 'login_success',
    color: SERIES_COLORS[1],
  },
]

/** Timestamp da SQL API (`YYYY-MM-DD HH:MM:SS`, UTC) ou ISO → epoch ms; NaN se inválido. */
function parseUtc(ts: string): number {
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T')
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`)
}

/** Hora UTC → dia da semana (domingo = 0) e hora em Brasília; null se a hora for inválida. */
export function toBrt(hourUtc: string): { weekday: number; hour: number } | null {
  const t = parseUtc(hourUtc)
  if (!Number.isFinite(t)) return null
  const brt = new Date(t - BRT_OFFSET_MS)
  return { weekday: brt.getUTCDay(), hour: brt.getUTCHours() }
}

/** Soma `measure` por dia da semana × hora em BRT; hora ou valor inválido é ignorado. */
export function buildHeatmapGrid(
  hourly: HeatmapResponse['hourly'],
  measure: HeatmapMeasure,
): HeatmapGrid {
  const field = MEASURES.find((m) => m.value === measure)!.field
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  let total = 0
  for (const row of hourly) {
    const slot = toBrt(row.hour)
    const value = Number(row[field])
    if (!slot || !Number.isFinite(value) || value <= 0) continue
    cells[slot.weekday][slot.hour] += value
    total += value
  }

  let peak: HeatmapGrid['peak'] = null
  for (let weekday = 0; weekday < 7; weekday++) {
    for (const hour of HOURS) {
      const value = cells[weekday][hour]
      if (value > 0 && (!peak || value > peak.value)) peak = { weekday, hour, value }
    }
  }
  return { cells, total, max: peak?.value ?? 0, peak }
}

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('pt-BR')
}

/** Cabe na célula estreita: 950, 1,2k, 12k. */
function compact(n: number): string {
  const rounded = Math.round(n)
  if (rounded < 1000) return String(rounded)
  const k = rounded / 1000
  return `${(k < 10 ? k.toFixed(1) : String(Math.round(k))).replace('.', ',')}k`
}

function hourRange(hour: number): string {
  return `${hour}h a ${(hour + 1) % 24}h`
}

/** `YYYY-MM-DD HH:MM:SS` UTC → `dd/mm hh:mm BRT`. */
function formatBrt(ts: string): string {
  const t = parseUtc(ts)
  if (!Number.isFinite(t)) return ts
  const d = new Date(t - BRT_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} BRT`
}

/** Ausência de coleta não é zero: avisa quando o tipo não cobre o período inteiro. */
function CoverageNotice({
  data,
  noun,
  firstSeen,
}: {
  data: HeatmapResponse
  noun: string
  firstSeen: string | null
}) {
  if (!firstSeen) {
    return (
      <p className={styles.samplingWarning}>
        Nenhum evento de {noun} foi registrado no Analytics Engine. A coleta é recente ou o deploy
        não chegou ao Worker, então falta dado para afirmar se houve atividade.
      </p>
    )
  }
  const first = parseUtc(firstSeen)
  // Folga de um dia: a retenção de 90 dias do Analytics Engine come o início da janela de 90d.
  if (Number.isFinite(first) && first > Date.now() - data.days * DAY_MS + DAY_MS) {
    return (
      <p className={styles.samplingWarning}>
        O primeiro evento de {noun} no Analytics Engine é de {formatBrt(firstSeen)}. Antes disso o
        mapa não tem dado.
      </p>
    )
  }
  return null
}

function Grid({
  grid,
  measure,
  estimated,
}: {
  grid: HeatmapGrid
  measure: (typeof MEASURES)[number]
  estimated: boolean
}) {
  const approx = estimated ? '≈' : ''
  return (
    <div className={styles.tableScroll}>
      <table
        className={styles.heatmap}
        aria-label={`Mapa de calor de ${measure.noun} por dia da semana e hora (BRT)`}
      >
        <thead>
          <tr>
            <th scope="col">
              <span className={styles.srOnly}>Dia da semana</span>
            </th>
            {HOURS.map((h) => (
              <th key={h} scope="col" className={styles.heatmapHour}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((label, weekday) => (
            <tr key={label}>
              <th scope="row" className={styles.heatmapDay} title={WEEKDAYS_LONG[weekday]}>
                {label}
              </th>
              {HOURS.map((hour) => {
                const value = grid.cells[weekday][hour]
                const pct = value > 0 ? Math.round(15 + 75 * (value / grid.max)) : 0
                return (
                  <td
                    key={hour}
                    className={value > 0 ? styles.heatmapCell : styles.heatmapCellEmpty}
                    style={
                      value > 0
                        ? {
                            backgroundColor: `color-mix(in srgb, ${measure.color} ${pct}%, transparent)`,
                          }
                        : undefined
                    }
                    title={`${WEEKDAYS_LONG[weekday]}, ${hourRange(hour)} BRT: ${approx}${formatNumber(value)} ${measure.noun}`}
                  >
                    {compact(value)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function isUsable(data: HeatmapResponse | null): data is HeatmapResponse {
  return !!data && Array.isArray(data.hourly) && !!data.firstSeenAt
}

export default function HeatmapSection({ data }: { data: HeatmapResponse | null }) {
  const [measureValue, setMeasureValue] = useState<HeatmapMeasure>('predictions')
  const measure = MEASURES.find((m) => m.value === measureValue)!

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Mapa de calor · palpites e logins</h2>
      {!isUsable(data) ? (
        <p className={styles.hint}>
          Indisponível: a API não enviou o mapa de calor, por deploy pendente ou falha na consulta.
          Sem a resposta, não há como afirmar se houve atividade.
        </p>
      ) : (
        <HeatmapBody data={data} measure={measure} onMeasureChange={setMeasureValue} />
      )}
    </section>
  )
}

function HeatmapBody({
  data,
  measure,
  onMeasureChange,
}: {
  data: HeatmapResponse
  measure: (typeof MEASURES)[number]
  onMeasureChange: (value: HeatmapMeasure) => void
}) {
  const grid = buildHeatmapGrid(data.hourly, measure.value)
  const estimated = Number(data.avgSampleInterval) > 1.01
  const firstSeen = data.firstSeenAt[measure.event] ?? null

  return (
    <>
      <p className={styles.hint}>
        Horários em BRT (UTC−3). Cada célula soma o dia da semana e a hora ao longo dos últimos{' '}
        {data.days} dias, para escolher janela de manutenção e horário de lembrete. Um dia da semana
        que ocorre uma vez a mais no período pesa mais na soma.
      </p>
      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>Série</span>
        <div className={`${shared.periods} ${styles.filterPills}`} role="group" aria-label="Série">
          {MEASURES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={m.value === measure.value}
              className={m.value === measure.value ? shared.periodActive : shared.period}
              onClick={() => onMeasureChange(m.value)}
            >
              <span
                className={styles.seriesDot}
                style={{ backgroundColor: m.color }}
                aria-hidden="true"
              />
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {estimated && (
        <p className={styles.samplingWarning}>
          O Analytics Engine amostrou estes eventos, com média de _sample_interval igual a{' '}
          {Number(data.avgSampleInterval).toFixed(2)}. As contagens são estimativas. O total e as descrições das células usam ≈.
        </p>
      )}
      <CoverageNotice data={data} noun={measure.noun} firstSeen={firstSeen} />
      {grid.total === 0 ? (
        firstSeen && <p className={styles.hint}>Nenhum evento de {measure.noun} no período.</p>
      ) : (
        <>
          <h3 className={styles.subTitle}>
            {measure.label} · {estimated ? '≈' : ''}
            {formatNumber(grid.total)} no período
          </h3>
          <Grid grid={grid} measure={measure} estimated={estimated} />
          {grid.peak && (
            <p className={styles.hint}>
              Maior movimento: {WEEKDAYS_LONG[grid.peak.weekday]}, {hourRange(grid.peak.hour)}, com{' '}
              {estimated ? '≈' : ''}
              {formatNumber(grid.peak.value)}. O cabeçalho das colunas é a hora inicial.
            </p>
          )}
        </>
      )}
    </>
  )
}
