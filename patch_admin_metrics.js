const fs = require('fs')

let code = fs.readFileSync('web/src/pages/AdminMetricsPage/AdminMetricsPage.tsx', 'utf-8')

const lines = code.split('\n')

// 1. Add imports at the top
const importIndex = lines.findIndex(l => l.includes('import { eventLabel }'))
lines.splice(importIndex + 1, 0, "import { ArchiveQueryResponse, ArchiveResponse, BusinessResponse, OverviewResponse } from './types'")
lines.splice(importIndex + 2, 0, "import { useMetricsData, CRON_INFO, isStale } from './useMetricsData'")

// 2. Remove the types
const typesStartIndex = lines.findIndex(l => l.includes('interface OverviewResponse'))
const typesEndIndex = lines.findIndex(l => l.includes('const MAX_CHART_TYPES = SERIES_COLORS.length'))

if (typesStartIndex !== -1 && typesEndIndex !== -1) {
  lines.splice(typesStartIndex, typesEndIndex - typesStartIndex)
}

// Helper to remove lines range exclusively at the end
const removeRange = (startStr, endStr) => {
    const s = lines.findIndex(l => l.includes(startStr))
    if (s === -1) return
    const e = lines.findIndex((l, i) => i > s && l.includes(endStr))
    if (e !== -1) {
        lines.splice(s, e - s)
    }
}

removeRange('const MAX_CHART_TYPES = SERIES_COLORS.length', 'function formatNumber')
removeRange('const CRON_INFO: Record<string, { label: string; staleAfterMin: number }> = {', 'function KpiCard({')
removeRange('function useMetricsData(overview: OverviewResponse | null, archive: ArchiveResponse | null) {', 'function StatusStrip({')

fs.writeFileSync('web/src/pages/AdminMetricsPage/AdminMetricsPage.tsx', lines.join('\n'))
