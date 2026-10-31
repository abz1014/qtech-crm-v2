import { formatAmount } from '@/lib/money'
import { formatShortDate } from '@/lib/formatDay'
import { specFor, type ColumnSpec } from '@/features/history/labels'
import type { HistoryEvent, HistoryPage } from '@/features/history/api'

/*
 * The History panel's brain, all pure: events from record_history() in, readable entries out.
 *
 *   "12 Oct 2026, 3:40 pm · Ayesha"      then   "Amount: PKR 5,000 → PKR 500"
 *
 * The values arrive already redacted for the caller's role (an engineer's events hold no money keys), so nothing here decides
 * who may see what: a column that is not in `was`/`now` is simply not shown.
 */

/** Edits by the same person this close together read as one change. */
export const MERGE_WINDOW_MS = 2 * 60 * 1000

export interface Change {
  /** "Amount". */
  label: string
  /** "PKR 5,000". Null for a line that has no before/after ("Removed line 'Valve DN50'"). */
  was: string | null
  now: string | null
  /** The whole sentence: "Amount: PKR 5,000 → PKR 500". */
  text: string
}

export interface Entry {
  key: string
  /** ISO time of the newest change in this entry; null for "Imported from old CRM". */
  at: string | null
  /** "12 Oct 2026, 3:40 pm". */
  when: string | null
  by: string | null
  kind: 'created' | 'changed' | 'removed' | 'imported'
  /** "Entered by Ayesha", "Removed by Ayesha", "Imported from old CRM"; null for a plain change. */
  title: string | null
  changes: Change[]
}

// ---------------------------------------------------------------- formatting
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const stampFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Karachi',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h12',
})

/** "12 Oct 2026, 3:40 pm" in Karachi time, whatever the device's own zone. */
export function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = Object.fromEntries(stampFmt.formatToParts(d).map(x => [x.type, x.value]))
  return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute} ${String(p.dayPeriod ?? '').toLowerCase()}`.trim()
}

const MAX_TEXT = 80
const isEmpty = (v: unknown) => v === null || v === undefined || v === ''
const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1).trimEnd()}…` : s)
const looksLikeId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)

/** One value in words: money as "PKR 5,000", dates as "12 Oct 2026", a name for an id, "Yes"/"No", "empty" when there is none. */
export function formatValue(spec: ColumnSpec, value: unknown, refs: Record<string, string> = {}): string {
  if (isEmpty(value)) return spec.empty ?? 'empty'
  switch (spec.kind) {
    case 'money': {
      const n = typeof value === 'number' || typeof value === 'string' ? value : String(value)
      try {
        return `PKR ${formatAmount(n)}`
      } catch {
        return String(value)
      }
    }
    case 'date': {
      const s = String(value)
      if (spec.month) {
        const mm = /^(\d{4})-(\d{2})/.exec(s)
        return mm ? `${MONTHS[Number(mm[2]) - 1]} ${mm[1]}` : s
      }
      return formatShortDate(s, undefined, true)
    }
    case 'datetime':
      return formatStamp(String(value))
    case 'bool':
      return value === true || value === 'true' ? 'Yes' : 'No'
    case 'ref': {
      const s = String(value)
      return refs[s] ?? 'another record'
    }
    case 'enum':
      return spec.words?.[String(value)] ?? String(value)
    case 'lines':
      return Array.isArray(value) ? `${value.length} ${value.length === 1 ? 'line' : 'lines'}` : 'changed'
    case 'hide':
      return ''
    default: {
      if (typeof value === 'object') return 'changed'
      const s = String(value)
      return looksLikeId(s) ? (refs[s] ?? 'another record') : clip(s)
    }
  }
}

const sameValue = (a: unknown, b: unknown) => (isEmpty(a) && isEmpty(b)) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0)
const lower = (s: string) => (s.length > 1 && s[1] === s[1].toUpperCase() && s[1] !== s[1].toLowerCase() ? s : s.charAt(0).toLowerCase() + s.slice(1))

// ---------------------------------------------------------------- one event to changes
const NOUN: Record<string, string> = {
  rfq_items: 'line',
  order_items: 'line',
  supplier_inquiries: 'supplier',
  clarifications: 'question',
  attachments: 'file',
  supplier_orders: 'supplier order',
  order_costs: 'costs',
  order_engineers: 'engineer',
  quotations: 'quotation',
  invoices: 'invoice',
  payments_in: 'payment',
  customer_refunds: 'refund',
  credit_applications: 'applied credit',
  expenses: 'expense',
  contacts: 'contact',
  company_sites: 'site',
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The columns that differ between was and now, as before/after pairs, in the order the labels list them. */
function diff(table: string, was: Record<string, unknown> | null, now: Record<string, unknown> | null, refs: Record<string, string>): Change[] {
  const out: Change[] = []
  const keys = [...new Set([...Object.keys(was ?? {}), ...Object.keys(now ?? {})])]
  for (const k of keys) {
    const spec = specFor(table, k)
    if (spec.kind === 'hide') continue
    const a = was?.[k]
    const b = now?.[k]
    if (sameValue(a, b)) continue
    if (spec.kind === 'lines' || (typeof a === 'object' && a !== null) || (typeof b === 'object' && b !== null)) {
      const x = count(a)
      const y = count(b)
      out.push({ label: spec.label, was: null, now: null, text: x === y ? `${spec.label} changed` : `${spec.label} changed (${x} → ${y})` })
      continue
    }
    const w = formatValue(spec, a, refs)
    const n = formatValue(spec, b, refs)
    if (w === n) continue
    out.push({ label: spec.label, was: w, now: n, text: `${spec.label}: ${w} → ${n}` })
  }
  return out
}

/** "Line 2 'Valve DN50'" / "Supplier 'Alpenmark Controls'": how a child line is named. */
function childName(e: HistoryEvent, refs: Record<string, string>): string {
  const noun = NOUN[e.table] ?? 'item'
  const row = e.now ?? e.was
  const pos = typeof row?.position === 'number' ? ` ${row.position + 1}` : ''
  const raw = e.child_label
  const name = raw ? (looksLikeId(raw) ? refs[raw] : raw) : undefined
  return `${capital(noun)}${pos}${name ? ` '${clip(name)}'` : ''}`
}

interface Draft {
  at: string
  by: string | null
  kind: Entry['kind']
  title: string | null
  changes: Change[]
}

function draftOf(e: HistoryEvent, root: string, refs: Record<string, string>): Draft | null {
  const who = e.by_name ?? null
  const base = { at: e.at, by: who }
  if (e.table === root) {
    if (e.action === 'insert') return { ...base, kind: 'created', title: who ? `Entered by ${who}` : 'Entered', changes: [] }
    if (e.action === 'delete') return { ...base, kind: 'removed', title: who ? `Removed by ${who}` : 'Removed', changes: [] }
    const changes = diff(e.table, e.was, e.now, refs)
    return changes.length ? { ...base, kind: 'changed', title: null, changes } : null
  }
  // a child line of the record
  const name = childName(e, refs)
  if (e.action === 'insert') return { ...base, kind: 'changed', title: null, changes: [{ label: name, was: null, now: null, text: `Added ${lower(name)}` }] }
  if (e.action === 'delete') return { ...base, kind: 'changed', title: null, changes: [{ label: name, was: null, now: null, text: `Removed ${lower(name)}` }] }
  const parts = diff(e.table, e.was, e.now, refs)
  if (!parts.length) return null
  return { ...base, kind: 'changed', title: null, changes: parts.map(c => ({ ...c, text: `${name}: ${lower(c.label)} ${c.was} → ${c.now}` })) }
}

// ---------------------------------------------------------------- merging
/** The same column changed twice in one entry reads once, from the first "was" to the last "now"; back where it began, it is dropped. */
function collapse(older: Change[], newer: Change[]): Change[] {
  const out = [...older]
  for (const c of newer) {
    const i = out.findIndex(o => o.label === c.label && o.was !== null && c.was !== null)
    if (i < 0) {
      out.push(c)
      continue
    }
    const first = out[i]
    if (first.was === c.now) out.splice(i, 1)
    else out[i] = { label: c.label, was: first.was, now: c.now, text: `${c.label}: ${first.was} → ${c.now}` }
  }
  return out
}

export interface TimelineOptions {
  /** The record's own table ("expenses"): its events are the record's; others are its child lines. */
  table: string
  /** The record came from the old CRM (legacy_source is set): with no insert in the history, it says so. */
  imported?: boolean
}

/** Pages (newest first, as record_history returns them) to entries, newest first. */
export function buildTimeline(pages: readonly HistoryPage[], opts: TimelineOptions): Entry[] {
  const refs: Record<string, string> = Object.assign({}, ...pages.map(p => p.refs))
  const events = pages.flatMap(p => p.events)
  const drafts: Draft[] = []
  for (const e of events) {
    const d = draftOf(e, opts.table, refs)
    if (d) drafts.push(d)
  }
  // events are newest first; merge a change into the entry after it (older) when it is the same person within the window
  const entries: Draft[] = []
  for (const d of drafts) {
    const prev = entries[entries.length - 1]
    const mergeable =
      prev &&
      prev.kind === 'changed' &&
      d.kind === 'changed' &&
      prev.by === d.by &&
      Math.abs(new Date(prev.at).getTime() - new Date(d.at).getTime()) <= MERGE_WINDOW_MS
    if (mergeable) {
      // d is older than prev
      prev.changes = collapse(d.changes, prev.changes)
      continue
    }
    entries.push({ ...d, changes: [...d.changes] })
  }
  const out: Entry[] = entries
    .filter(d => d.kind !== 'changed' || d.changes.length > 0)
    .map((d, i) => ({ key: `${d.at}-${i}`, at: d.at, when: formatStamp(d.at), by: d.by, kind: d.kind, title: d.title, changes: d.changes }))
  const lastPage = pages[pages.length - 1]
  const hasInsert = events.some(e => e.table === opts.table && e.action === 'insert')
  if (opts.imported && !hasInsert && lastPage && !lastPage.has_more) {
    out.push({ key: 'imported', at: null, when: null, by: null, kind: 'imported', title: 'Imported from old CRM', changes: [] })
  }
  return out
}

// "Last changed by" lives in lastChangedLine.ts (small, so the record pages do not carry this file's labels with it)
export { agoWords, lastChangedLine } from '@/features/history/lastChangedLine'
