// Pure model behind Settings > Exchange rates and the rate bar on the RFQ page (R15). Bands are the ones in v_fx_latest
// (DATA_MODEL section 5, A2b): fresh up to 7 days, stale 8 to 30, unusable over 30.

import type { FxLatestRow } from '@/features/rfqs/api'
import { REPLY_CURRENCIES } from '@/features/rfqs/lib/replyCurrency'

export const CURRENCY_NAMES: Record<string, string> = {
  USD: 'US dollar',
  EUR: 'Euro',
  AED: 'UAE dirham',
  CNY: 'Chinese yuan',
  GBP: 'Pound sterling',
  JPY: 'Japanese yen',
  SAR: 'Saudi riyal',
}

export interface RateRow {
  currency: string
  name: string
  /** Null: no rate has ever been set for this currency. */
  ratePkr: number | null
  asOf: string | null
  ageDays: number | null
  source: 'auto' | 'manual' | null
  staleness: 'fresh' | 'stale' | 'unusable' | null
}

/** The latest rate per currency, then every currency the app offers that has none yet, so "Add rate" is always there. */
export function buildRateRows(latest: readonly FxLatestRow[], offered: readonly string[] = REPLY_CURRENCIES): RateRow[] {
  const rows: RateRow[] = latest.map(r => ({
    currency: r.currency,
    name: CURRENCY_NAMES[r.currency] ?? r.currency,
    ratePkr: r.ratePkr,
    asOf: r.asOf,
    ageDays: r.ageDays,
    source: r.source === 'manual' ? 'manual' : 'auto',
    staleness: r.staleness,
  }))
  const have = new Set(rows.map(r => r.currency))
  for (const c of offered) {
    if (c === 'PKR' || have.has(c)) continue
    rows.push({ currency: c, name: CURRENCY_NAMES[c] ?? c, ratePkr: null, asOf: null, ageDays: null, source: null, staleness: null })
  }
  // Fresh first, then stale, then unusable, then no rate; alphabetical inside a group.
  const rank = (r: RateRow) => (r.staleness === 'fresh' ? 0 : r.staleness === 'stale' ? 1 : r.staleness === 'unusable' ? 2 : 3)
  return rows.sort((a, b) => rank(a) - rank(b) || a.currency.localeCompare(b.currency))
}

/** "today", "1 day", "8 days". */
export function ageText(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`
}

/**
 * The Age cell's words (round 2, spec 1.5): a fresh rate is just its age ("today", "3 days"); an old one is the chip "Old rate"
 * and an unusable one "No rate", each with "8 days old" as the chip's detail. Returns what is read, chip label first.
 */
export function bandLabel(staleness: 'fresh' | 'stale' | 'unusable', ageDays: number): string {
  if (staleness === 'fresh') return ageText(ageDays)
  return `${staleness === 'stale' ? 'Old rate' : 'No rate'}, ${bandDetail(ageDays)}`
}

/** The chip's detail: "8 days old". */
export const bandDetail = (ageDays: number): string => `${ageText(ageDays)} old`

/** The sentence under the table for a rate that can no longer be used; null for any other band. */
export function unusableWarning(r: RateRow): string | null {
  if (r.staleness !== 'unusable' || r.ageDays === null) return null
  return `${r.currency} has not been updated for ${r.ageDays} days. A rate older than 30 days is not used, so ${r.currency} quotes show in ${r.currency} only and are left out of price comparisons until someone adds a current rate.`
}

const runDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short' })
const runTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false })

/** "Automatic update ran Fri 27 Nov, 02:10" (Karachi time), from the newest automatic rate row's created_at. */
export function autoRunStamp(createdAt: string): string {
  const d = new Date(createdAt)
  return `Automatic update ran ${runDay.format(d).replace(',', '')}, ${runTime.format(d)}`
}

/** The words for where a rate came from. */
export function sourceText(source: 'auto' | 'manual' | null): string {
  return source === 'manual' ? 'Entered by hand' : source === 'auto' ? 'Automatic' : 'No rate yet'
}

/** The rate bar on the RFQ page: one entry per currency that matters here (has a rate, or appears on a price). */
export interface RateBarEntry {
  currency: string
  ratePkr: number | null
  ageDays: number | null
  staleness: 'fresh' | 'stale' | 'unusable' | null
  source: 'auto' | 'manual' | null
}

export function buildRateBar(latest: readonly FxLatestRow[], currenciesOnPrices: readonly string[]): RateBarEntry[] {
  const by = new Map(latest.map(r => [r.currency, r]))
  const wanted = [...new Set([...latest.map(r => r.currency), ...currenciesOnPrices.filter(c => c !== 'PKR')])]
  return wanted
    .map(c => {
      const r = by.get(c)
      return {
        currency: c,
        ratePkr: r ? r.ratePkr : null,
        ageDays: r ? r.ageDays : null,
        staleness: r ? r.staleness : null,
        source: r ? (r.source === 'manual' ? ('manual' as const) : ('auto' as const)) : null,
      }
    })
    .sort((a, b) => (a.ratePkr === null ? 1 : 0) - (b.ratePkr === null ? 1 : 0) || a.currency.localeCompare(b.currency))
}

/** "auto · today", "auto · 3 days ago", "by hand · today", "auto · 12 days ago, stale". */
export function rateBarNote(e: RateBarEntry): string {
  const who = e.source === 'manual' ? 'by hand' : 'auto'
  const age = e.ageDays === null ? '' : e.ageDays <= 0 ? 'today' : `${e.ageDays} ${e.ageDays === 1 ? 'day' : 'days'} ago`
  const band = e.staleness === 'stale' ? ', stale' : e.staleness === 'unusable' ? ', too old' : ''
  return `${who} · ${age}${band}`
}
