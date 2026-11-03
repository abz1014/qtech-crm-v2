import type { OrderHeader, OrderItemRow } from '@/features/orders/api'

/*
 * Delivery challans (migration 0131). The paper that goes with the goods: its own DC- number, where it goes, and the lines and quantities
 * delivered. Never a price. An order can have several (a part delivery, then the rest); each keeps the lines it was issued with.
 */
export interface ChallanLine {
  itemId: string | null
  description: string
  unit: string | null
  qty: number
}

export interface ChallanRow {
  id: string
  orderId: string
  number: string
  issuedOn: string
  deliverTo: string | null
  notes: string | null
  lines: ChallanLine[]
}

/** The lines column (jsonb) as the screen holds it; anything unreadable is left out rather than guessed. */
export function parseLines(raw: unknown): ChallanLine[] {
  if (!Array.isArray(raw)) return []
  const out: ChallanLine[] = []
  for (const r of raw as Array<Record<string, unknown>>) {
    const qty = Number(r.qty)
    if (typeof r.description !== 'string' || !Number.isFinite(qty)) continue
    out.push({ itemId: typeof r.item_id === 'string' ? r.item_id : null, description: r.description, unit: typeof r.unit === 'string' ? r.unit : null, qty })
  }
  return out
}

export function toChallan(r: { id: string; order_id: string; number: string; issued_on: string; deliver_to: string | null; notes: string | null; lines: unknown }): ChallanRow {
  return { id: r.id, orderId: r.order_id, number: r.number, issuedOn: r.issued_on, deliverTo: r.deliver_to, notes: r.notes, lines: parseLines(r.lines) }
}

/** Where the goods go, offered when a challan is made: the site's name and address (the customer's name goes on the paper anyway). */
export function defaultDeliverTo(order: Pick<OrderHeader, 'site'>): string {
  return [order.site?.name, order.site?.address].filter(Boolean).join('\n')
}

/** What the new-challan form holds for each goods line: ticked in, and how many go this time (the whole ordered quantity to begin with). */
export interface PickLine {
  itemId: string
  description: string
  unit: string | null
  ordered: number
  include: boolean
  qty: string
}

/** The goods lines of the order, all ticked, at their ordered quantity (a service line is never on a challan). */
export function startPick(items: readonly OrderItemRow[]): PickLine[] {
  return items.filter(i => !i.isService).map(i => ({ itemId: i.id, description: i.description, unit: i.unit, ordered: i.qty, include: true, qty: String(i.qty) }))
}

export function pickProblem(l: PickLine): string | null {
  if (!l.include) return null
  const n = Number(l.qty)
  if (!l.qty.trim() || !Number.isFinite(n) || n <= 0) return 'Enter how many.'
  if (n > l.ordered) return `The order has ${l.ordered}.`
  return null
}

/** The lines to send: ticked ones with a good quantity. Empty when nothing is ticked or any ticked line has a problem. */
export function pickPayload(lines: readonly PickLine[]): Array<{ item_id: string; qty: number }> {
  const ticked = lines.filter(l => l.include)
  if (ticked.length === 0 || ticked.some(l => pickProblem(l))) return []
  return ticked.map(l => ({ item_id: l.itemId, qty: Number(l.qty) }))
}

/** The challan is for a part delivery when it does not cover every goods line in full. */
export const isPartial = (picked: readonly PickLine[]): boolean => picked.some(l => !l.include || Number(l.qty) < l.ordered)
