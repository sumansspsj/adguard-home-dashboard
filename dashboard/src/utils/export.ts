import { type QueryLogEntry } from '../api'

/** Convert an array of objects to CSV string */
function toCSV(rows: Record<string, string | number | boolean>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const lines = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        let v = String(row[h] ?? '')
        if (/^[=+\-@\t\r]/.test(v)) {
          v = `'${v}`
        }
        return v.includes(',') || v.includes('"') || v.includes('\n')
          ? `"${v.replace(/"/g, '""')}"`
          : v
      }).join(',')
    ),
  ]
  return lines.join('\n')
}

/** Trigger a file download in the browser */
function downloadFile(content: string, filename: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Export query log entries as CSV */
export function exportQueryLog(entries: QueryLogEntry[], filename = 'dns-query-log.csv') {
  const rows = entries.map(e => ({
    time: e.time,
    client: e.client,
    client_name: e.client_info?.name ?? '',
    domain: e.question?.name ?? '',
    type: e.question?.type ?? '',
    status: e.reason ?? '',
    cached: e.cached,
    elapsed_ms: e.elapsedMs ?? '',
    upstream: e.upstream ?? '',
    rule: e.rule ?? '',
    answer_dnssec: e.answer_dnssec,
  }))
  downloadFile(toCSV(rows), filename)
}

/** Export domain list as CSV */
export function exportDomains(
  domains: [string, number][],
  type: 'queried' | 'blocked',
  filename?: string
) {
  const rows = domains.map(([domain, count]) => ({ domain, count, type }))
  downloadFile(toCSV(rows), filename ?? `dns-${type}-domains.csv`)
}

/** Export client list as CSV */
export function exportClients(
  clients: { name: string; ip: string; queries: number; blocked: number; pct: string }[],
  filename = 'dns-clients.csv'
) {
  downloadFile(toCSV(clients), filename)
}
