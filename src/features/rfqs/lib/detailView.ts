// Pure rules behind the RFQ page as drawn in g2-rfq-detail (parity audit Part C). Framework-free, so they are tested without a screen.

import { formatDay } from '@/lib/formatDay'
import { COUNT_WORDS_MAX_DAYS, daysOverdue, dueWord, inDays } from '@/lib/timeWords'

// ------------------------------------------------------------------------------------------------ coverage of one item

export type CoverageKind = 'covered' | 'partly' | 'uncovered' | 'none' | 'unasked'

export interface Coverage {
  kind: CoverageKind
  /**
   * The item's one chip, an `item-price` registry value (consistency spec 1.5): Priced, Waiting for prices or No price yet. Null
   * while nobody has been asked: the item then says so in a sentence, and the header's stage chip already reads "Needs suppliers".
   */
  value: 'priced' | 'waiting' | 'none' | null
  /** The chip's mono detail: "3 prices", "1 price so far". */
  detail?: string
}

/**
 * The chip on an item (C-23), in the registry's `item-price` words, so it agrees with the header's stage chip and the board:
 *  - a price and nobody still to answer  -> Priced · n prices
 *  - a price and somebody still waiting  -> Priced · n price(s) so far     (the owner's partial-quote rule: it can still improve)
 *  - nobody asked yet                    -> no chip                        (a supplier only on the shortlist is not asked)
 *  - no price, but others replied        -> No price yet
 *  - no price, somebody still to answer  -> Waiting for prices
 *  - no price and nobody left to answer  -> No price yet                   (everyone asked said they cannot quote it)
 * `waiting` is the number of suppliers asked about this item who have not answered it; `responders` the suppliers who quoted any
 * item; `asked` the suppliers asked at all (sent, or answered "cannot quote").
 */
export function itemCoverage(prices: number, waiting: number, responders: number, asked: number): Coverage {
  if (prices > 0) {
    const n = `${prices} ${prices === 1 ? 'price' : 'prices'}`
    return waiting > 0 ? { kind: 'partly', value: 'priced', detail: `${n} so far` } : { kind: 'covered', value: 'priced', detail: n }
  }
  if (asked === 0) return { kind: 'unasked', value: null }
  if (responders > 0 || waiting === 0) return { kind: 'uncovered', value: 'none' }
  return { kind: 'none', value: 'waiting' }
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

/** Due more than 30 days ago: red is kept for a promise that slipped within the last 30 days (redesign phase 0). */
const longLate = (daysToDue: number | null | undefined): boolean => daysToDue !== null && daysToDue !== undefined && -daysToDue > COUNT_WORDS_MAX_DAYS

/**
 * "Due in 4 days", "Due tomorrow", "3 days overdue" as one chip (C-05), in the shared time words (src/lib/timeWords.ts). Null when
 * there is nothing to say (no date, or more than a week away).
 */
export function dueChipLabel(daysToDue: number | null | undefined, isOverdue: boolean): string | null {
  if (longLate(daysToDue)) return null // more than 30 days late: no red chip and no count (redesign phase 0); the date tile says it
  if (isOverdue && daysToDue !== null && daysToDue !== undefined && daysToDue < 0) return daysOverdue(-daysToDue)
  if (daysToDue === null || daysToDue === undefined || daysToDue > 7) return null
  return dueWord(Math.max(0, daysToDue))
}

/**
 * The quotation due date needs attention (grade-B R7): overdue, or two days or less away. Only then is it orange (the tile) and a
 * chip; further off it is plain text.
 */
export function dueIsUrgent(daysToDue: number | null | undefined, isOverdue: boolean): boolean {
  if (longLate(daysToDue)) return false
  if (isOverdue) return true
  return daysToDue !== null && daysToDue !== undefined && daysToDue <= 2
}

/** Customer refs like "RFF/PUR/261/1": the places a long one may break on a narrow phone (after each "/", "-" or "_"). */
export function refBreaks(ref: string): string[] {
  return ref.split(/(?<=[/_-])/)
}

/** The label for a bid-due sub-line: "In 4 days", "Tomorrow", "Today", "3 days ago". */
export function dueSubLabel(daysToDue: number | null | undefined): string | null {
  if (daysToDue === null || daysToDue === undefined) return null
  return inDays(daysToDue)
}
