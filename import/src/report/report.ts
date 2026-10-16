import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toCsv } from '../lib/csv'
import type { MoneyLine, Reconciliation, ReviewItem, TransformResult } from '../types'

// The report: counts, money totals old against new, and one CSV per review list. Review CSVs name companies and
// orders from the real data, so they are only ever written under import/.data (gitignored) or a folder the owner picks.

const REVIEW_COLUMNS = ['table', 'old_id', 'label', 'detail']

export function reviewLists(items: ReviewItem[]): Map<string, ReviewItem[]> {
  const m = new Map<string, ReviewItem[]>()
  for (const it of items) m.set(it.list, [...(m.get(it.list) ?? []), it])
  return new Map([...m].sort(([a], [b]) => (a < b ? -1 : 1)))
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function moneyRow(l: MoneyLine, label = l.key): string {
  return `| ${label} | ${fmt(l.old)} | ${fmt(l.neu)} | ${fmt(l.excluded)} | ${fmt(l.diff)} |`
}

/** Money reconciles when old = new + excluded on every line. */
export function reconciles(r: Reconciliation): boolean {
  const lines = [r.payments, r.expensesTotal, r.orderValue, r.invoiceNet, r.invoiceGst, ...r.expensesByCategory]
  return lines.every(l => l.diff === 0)
}

export function renderReport(r: TransformResult, title = 'Import report'): string {
  const out: string[] = [`# ${title}`, '']

  out.push('## Rows', '', '| Old table | Rows | Could not import |', '|---|---:|---:|')
  for (const c of r.sourceCounts) out.push(`| ${c.table} | ${c.rows} | ${c.dropped} |`)
  out.push('', '| New table | Rows going in |', '|---|---:|')
  for (const c of r.importedCounts) out.push(`| ${c.table} | ${c.rows} |`)

  out.push('', '## Left behind on purpose', '', '| Old table | Rows | Why |', '|---|---:|---|')
  for (const d of r.droppedByDesign) out.push(`| ${d.table} | ${d.rows} | ${d.note} |`)

  out.push(
    '',
    '## Money: old against new',
    '',
    'Old = new + left out must hold on every line. Left out = rows that could not be imported (listed in dropped_rows).',
    '',
    '| Line | Old | New | Left out | Difference |',
    '|---|---:|---:|---:|---:|',
    moneyRow(r.recon.payments, 'Payments in (gross)'),
    moneyRow(r.recon.expensesTotal, 'Expenses, all categories'),
    ...r.recon.expensesByCategory.map(l => moneyRow(l, `  ${l.key}`)),
    moneyRow(r.recon.orderValue, 'Order value / item net'),
    moneyRow(r.recon.invoiceNet, 'Invoice net'),
    moneyRow(r.recon.invoiceGst, 'Invoice GST'),
    '',
    `Reconciles: **${reconciles(r.recon) ? 'yes' : 'NO'}**`,
  )

  if (r.recon.orderInvoice.length) {
    out.push('', '## Orders with invoices: item net against invoice net', '', '| PO | Item net | Invoice net | Difference | Basis |', '|---|---:|---:|---:|---|')
    for (const o of r.recon.orderInvoice) {
      out.push(`| ${o.poNumber ?? '(no PO)'} | ${fmt(o.itemsNet)} | ${fmt(o.invoiceNet)} | ${fmt(o.diff)} | ${o.basisUnknown ? 'unknown (flagged)' : 'proven net'} |`)
    }
  }

  out.push('', '## Review lists', '', '| List | Items |', '|---|---:|')
  for (const [list, items] of reviewLists(r.review)) out.push(`| ${list}.csv | ${items.length} |`)
  out.push('')
  return out.join('\n')
}

/** Writes report.md, report.json and one <list>.csv per review list. Returns the files written. */
export function writeReport(dir: string, r: TransformResult, title?: string): string[] {
  mkdirSync(dir, { recursive: true })
  const files: string[] = []
  const put = (name: string, text: string) => {
    writeFileSync(join(dir, name), text, 'utf8')
    files.push(name)
  }
  put('report.md', renderReport(r, title))
  put(
    'report.json',
    JSON.stringify({ sourceCounts: r.sourceCounts, importedCounts: r.importedCounts, droppedByDesign: r.droppedByDesign, recon: r.recon }, null, 2) + '\n',
  )
  for (const [list, items] of reviewLists(r.review)) {
    put(`${list}.csv`, toCsv(REVIEW_COLUMNS, items.map(i => ({ table: i.table, old_id: i.oldId, label: i.label, detail: i.detail }))))
  }
  return files
}
