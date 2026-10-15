// Pure rules behind the RFQ page as drawn in g2-rfq-detail (parity audit Part C). Framework-free, so they are tested without a screen.

import { formatDay } from '@/lib/formatDay'

// ------------------------------------------------------------------------------------------------ coverage of one item

export type CoverageKind = 'covered' | 'partly' | 'uncovered' | 'none'

export interface Coverage {
  kind: CoverageKind
  /** The chip's words: "Covered, 3 prices", "Partly covered, 1 price", "Uncovered item", "No replies yet". */
  label: string
}

/**
 * The chip on an item (C-23):
 *  - a price and nobody still to answer  -> Covered, n prices
 *  - a price and somebody still waiting  -> Partly covered, n price(s)     (the owner's partial-quote rule: it can still improve)
 *  - no price, but others replied        -> Uncovered item
 *  - no price and no replies             -> No replies yet
 * `waiting` is the number of suppliers asked about this item who have not answered it; `responders` the suppliers who quoted any item.
 */
export function itemCoverage(prices: number, waiting: number, responders: number): Coverage {
  if (prices > 0) {
    const n = `${prices} ${prices === 1 ? 'price' : 'prices'}`
    return waiting > 0 ? { kind: 'partly', label: `Partly covered, ${n}` } : { kind: 'covered', label: `Covered, ${n}` }
  }
  if (responders > 0) return { kind: 'uncovered', label: 'Uncovered item' }
  return { kind: 'none', label: 'No replies yet' }
}

/** The footnote under an item's price rows (C-35). */
export function comparisonNote(input: {
  comparable: number
  basis: 'native' | 'pkr'
  notCompared: readonly string[]
  staleRates: ReadonlyArray<{ currency: string; days: number }>
  lines: number
}): string {
  if (input.lines === 0) return 'Nobody has priced this item.'
  if (input.comparable < 2) return 'One price so far. Nothing to compare yet.'
  const parts = [`Lowest of the ${input.comparable} with a rate.`]
  parts.push(input.basis === 'pkr' ? "Compared in PKR at today's rates." : 'Same currency, compared as quoted.')
  const out = [...new Set(input.notCompared)]
  if (out.length > 0) parts.push(out.length === 1 ? `The ${out[0]} line is not compared.` : `The ${out.join(' and ')} lines are not compared.`)
  const stale = input.staleRates[0]
  if (stale) parts.push(`The ${stale.currency} rate is ${stale.days} days old, so treat the gap as indicative.`)
  return parts.join(' ')
}

// ------------------------------------------------------------------------------------------------ suppliers asked

export interface SupplierFacts {
  asked: number | null
  replied: number | null
  median_reply_days: number | null
}

const timesWord = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)
const daysWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

export interface MemoryLine {
  text: string
  /** The wait so far is longer than their usual: shown amber. */
  late: boolean
}

/**
 * The memory line under a supplier (C-50). With under 3 asks it only states the counts and says it cannot say more; from 3 asks
 * it adds the usual reply time and, while the supplier is still silent, how long this one has been waiting.
 */
export function supplierMemoryLine(stats: SupplierFacts | null | undefined, waitingDays: number | null): MemoryLine | null {
  const asked = stats?.asked ?? 0
  const replied = stats?.replied ?? 0
  if (asked <= 0) return null
  const repliesText = replied === 0 ? 'no reply' : replied === 1 ? '1 reply' : `${replied} replies`
  if (asked < 3) return { text: `Asked ${timesWord(asked)}, ${repliesText}. Not enough history to say more.`, late: false }
  const median = stats?.median_reply_days
  if (median === null || median === undefined) return { text: `Replied ${replied} of ${asked} · reply time needs 3 replies logged here`, late: false }
  const usual = Math.max(0, Math.round(median))
  let text = `Replied ${replied} of ${asked} · usually ${usual < 1 ? 'the same day' : `~${daysWord(usual)}`}`
  let late = false
  if (waitingDays !== null) {
    text += `, now ${daysWord(waitingDays)}`
    late = waitingDays > usual
  }
  return { text, late }
}

export interface SentLineInput {
  sentOn: string | null
  lastChasedOn: string | null
  chaseCount: number
  noOfferOn: string | null
  quoteReceivedOn?: string | null
}

/** "Sent Sun 22 Nov · replied Mon 23 Nov" / "· chased Wed 25 Nov" / "· can't quote Mon 23 Nov" / "Not sent yet". */
export function sentLine(i: SentLineInput): string {
  if (!i.sentOn) return 'Not sent yet'
  const parts = [`Sent ${formatDay(i.sentOn)}`]
  if (i.quoteReceivedOn) parts.push(`replied ${formatDay(i.quoteReceivedOn)}`)
  else if (i.noOfferOn) parts.push(`can't quote ${formatDay(i.noOfferOn)}`)
  else if (i.lastChasedOn) parts.push(`chased ${formatDay(i.lastChasedOn)}`)
  return parts.join(' · ')
}

/** Whole days from `from` to `to` (YYYY-MM-DD), never below zero. */
export function daysSince(from: string, to: string): number {
  const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
  return Math.max(0, Math.round((t(to) - t(from)) / 86_400_000))
}

// ------------------------------------------------------------------------------------------------ the deadline chip

/** "Due in 4 days", "Due tomorrow"... as one chip (C-05). Null when there is nothing to say (no date, or more than a week away). */
export function dueChipLabel(daysToDue: number | null | undefined, isOverdue: boolean): string | null {
  if (isOverdue && daysToDue !== null && daysToDue !== undefined && daysToDue < 0) return daysToDue === -1 ? 'Overdue by 1 day' : `Overdue by ${-daysToDue} days`
  if (daysToDue === null || daysToDue === undefined || daysToDue > 7) return null
  if (daysToDue <= 0) return 'Due today'
  return daysToDue === 1 ? 'Due in 1 day' : `Due in ${daysToDue} days`
}

/** The label for a bid-due sub-line: "In 4 days", "Today", "3 days ago". */
export function dueSubLabel(daysToDue: number | null | undefined): string | null {
  if (daysToDue === null || daysToDue === undefined) return null
  if (daysToDue < 0) return `${-daysToDue} ${daysToDue === -1 ? 'day' : 'days'} ago`
  if (daysToDue === 0) return 'Today'
  return `In ${daysToDue} ${daysToDue === 1 ? 'day' : 'days'}`
}
