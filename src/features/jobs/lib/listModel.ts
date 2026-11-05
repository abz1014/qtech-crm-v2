import type { JobRow } from '@/features/jobs/api'
import { currentStopIndex } from '@/features/jobs/lib/stages'

/*
 * The Jobs list's view: three chips (Mine, Open, History) and a sort by what is due first. History is closed, settled or lost
 * work only (owner decision 1b): exactly the rows the database marks is_history, never anything else. A search ignores the chips
 * (a number must find its job wherever it is), and says which list each match is in.
 */
export const CHIPS = ['mine', 'open', 'history'] as const
export type Chip = (typeof CHIPS)[number]
export const isChip = (v: string | null): v is Chip => v !== null && (CHIPS as readonly string[]).includes(v)

export interface Who {
  userId: string | null
  role: 'admin' | 'sales' | 'engineer' | ''
}

/** Sales and engineers start on their own jobs; the admin on every open job. */
export const defaultChip = (role: Who['role']): Chip => (role === 'sales' || role === 'engineer' ? 'mine' : 'open')

/** A job is mine when I own it or (an engineer) I am put on its order. */
export function isMine(j: JobRow, who: Who): boolean {
  if (!who.userId) return false
  return j.ownerId === who.userId || j.engineerIds.includes(who.userId)
}

export function inChip(j: JobRow, chip: Chip, who: Who): boolean {
  if (chip === 'history') return j.isHistory
  if (j.isHistory) return false
  return chip === 'open' ? true : isMine(j, who)
}

export function chipCounts(all: readonly JobRow[], who: Who): Record<Chip, number> {
  return { mine: all.filter(j => inChip(j, 'mine', who)).length, open: all.filter(j => inChip(j, 'open', who)).length, history: all.filter(j => j.isHistory).length }
}

/** Newest activity first; ties by the newer job number. */
export function byRecent(a: JobRow, b: JobRow): number {
  return (b.lastActivityOn ?? '').localeCompare(a.lastActivityOn ?? '') || b.key.localeCompare(a.key, undefined, { numeric: true })
}

/** "Job 139", "Job O-45". */
export const jobLabel = (key: string) => `Job ${key}`

/*
 * The stage filter (2026-11-03): where a job stands on the StageBar ruler, so a filter and the bar always agree. The stop comes from
 * currentStopIndex (0 to 6, 7 = paid, null = lost or cancelled).
 *   orders    the customer has ordered: a live order exists and the job is at or past "ordered" (an order job is also in one more filter)
 *   supplier  Waiting for supplier: stop 3 (an item to source, a supplier order to place, or placed and not here yet)
 *   deliver   To deliver: stop 4 (goods arrived or part delivered, not all delivered)
 *   invoice   To invoice: stop 5
 *   payment   To be paid: stop 6, which is the stage "invoiced" only (what customers owe stays in Money, Who owes us)
 * Lost, cancelled and enquiry-only jobs are in no filter. Nothing here is money, so an engineer may filter too, on the first four.
 */
export const STAGE_FILTERS = ['orders', 'supplier', 'deliver', 'invoice', 'payment'] as const
export type StageFilter = (typeof STAGE_FILTERS)[number]
export const isStageFilter = (v: string | null): v is StageFilter => v !== null && (STAGE_FILTERS as readonly string[]).includes(v)

export const STAGE_LABEL: Record<StageFilter, string> = {
  orders: 'Orders',
  supplier: 'Waiting for supplier',
  deliver: 'To deliver',
  invoice: 'To invoice',
  payment: 'To be paid',
}

const ORDER_STAGES = ['ordered', 'supplier_ordered', 'delivered', 'invoiced', 'paid']
const STOP_OF: Record<Exclude<StageFilter, 'orders'>, number> = { supplier: 3, deliver: 4, invoice: 5, payment: 6 }

/** The options this person is offered after "All": an engineer has no invoice or payment words; History holds finished work, so only Orders. */
export function stagesFor(role: Who['role'], chip: Chip): StageFilter[] {
  if (chip === 'history') return ['orders']
  return role === 'admin' || role === 'sales' ? [...STAGE_FILTERS] : ['orders', 'supplier', 'deliver']
}

/** The stage a ?stage= value stands for: anything unknown, or not offered to this person or chip, is All (null). */
export function normalizeStage(param: string | null, role: Who['role'], chip: Chip): StageFilter | null {
  return isStageFilter(param) && stagesFor(role, chip).includes(param) ? param : null
}

export function inStage(j: JobRow, s: StageFilter): boolean {
  if (s === 'orders') return j.orderId !== null && j.stage !== null && ORDER_STAGES.includes(j.stage)
  return currentStopIndex(j.stage, j.stageDetail) === STOP_OF[s]
}

/**
 * The items line of a job card, in one short line: "Flow meter +2 more" is "3 items · Flow meter"; anything else is said as it is
 * (a clamp to one line is the caller's). Empty text stays empty.
 */
export function itemsSummary(items: string | null | undefined): string {
  const s = (items ?? '').replace(/\s+/g, ' ').trim()
  const m = /^(.*?)\s*\+\s*(\d+)\s+more$/i.exec(s)
  if (!m || !m[1]) return s
  return `${Number(m[2]) + 1} items · ${m[1]}`
}
