// R07: what saving one supplier's reply row writes. Pure, so the rules are tested without a screen.
//
//  - A price typed (greater than zero) becomes a quote line for that item, in the row's currency.
//  - A line that already exists is updated in place when its currency is unchanged.
//  - A line whose currency changed is removed and entered again, so the database captures today's rate for the new currency
//    (the capture trigger only runs on insert).
//  - A price that was cleared removes its line. A blank item that never had a line writes nothing.
//  - Lead time is per item (owner, 16 Nov 2026): each line carries its own. An item with no lead time of its own takes the row's.
//  - Every priced item needs a lead time and the weight of one unit before the reply is saved (missingQuoteDetails). The database
//    leaves both optional, so older lines without them stay valid and readable; the rule is the app's.

import type { WeightUnit } from './replyParse'

/** What a supplier said about one item besides its price (0111): weight of ONE unit, and where it is made. */
export interface ItemExtras {
  weight: number | null
  weightUnit: WeightUnit
  origin: string
}

export interface ExistingLine {
  itemId: string
  unitPrice: number
  currency: string
  leadTime: string | null
  inStock: boolean | null
  weight?: number | null
  weightUnit?: WeightUnit | null
  origin?: string | null
}

export interface ReplyDraft {
  /** The row's currency, pre-filled and rarely changed. */
  currency: string
  /** Price typed per item id. Null or missing: nothing typed. */
  prices: Readonly<Record<string, number | null | undefined>>
  /** The row's lead time: what an item without one of its own takes (a pasted reply that states one delivery for all). */
  leadTime: string
  /** Lead time per item id, as typed on the item. A missing entry takes the row's `leadTime`. */
  leadTimes?: Readonly<Record<string, string | undefined>>
  inStock: boolean | null
  /** Weight and origin per item id. A missing entry leaves what is saved alone. */
  extras?: Readonly<Record<string, ItemExtras | undefined>>
}

export interface PlannedPrice {
  itemId: string
  unitPrice: number
  /** This item's lead time (its own, else the row's). Absent: the save writes the row's lead time. */
  leadTime?: string | null
  /** Set only when the draft holds extras for the item; absent means "do not touch". */
  weight?: number | null
  weightUnit?: WeightUnit
  origin?: string | null
}

export interface ReplyPlan {
  prices: PlannedPrice[]
  removeItemIds: string[]
  leadTime: string | null
  inStock: boolean | null
}

const validWeight = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null)
const valid = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/** The lead time an item will be saved with: its own, else the row's. Empty when neither is typed. */
export function itemLeadTime(draft: ReplyDraft, itemId: string): string {
  return (draft.leadTimes?.[itemId] ?? draft.leadTime).trim()
}

/** What is still needed for one priced item before the reply can be saved. */
export interface MissingDetails {
  leadTime: boolean
  weight: boolean
}

/**
 * The priced items that still lack a lead time or a weight of one unit above zero, by item id (owner, 16 Nov 2026: both are
 * required for every item that gets a price). An item with no price, or one the supplier cannot offer, needs neither.
 */
export function missingQuoteDetails(draft: ReplyDraft): Record<string, MissingDetails> {
  const out: Record<string, MissingDetails> = {}
  for (const [itemId, price] of Object.entries(draft.prices)) {
    if (!valid(price)) continue
    const leadTime = itemLeadTime(draft, itemId) === ''
    const weight = validWeight(draft.extras?.[itemId]?.weight) === null
    if (leadTime || weight) out[itemId] = { leadTime, weight }
  }
  return out
}

export function planReplySave(existing: readonly ExistingLine[], draft: ReplyDraft): ReplyPlan {
  const byItem = new Map(existing.map(l => [l.itemId, l]))
  const prices: ReplyPlan['prices'] = []
  const removeItemIds: string[] = []
  const itemIds = new Set([...byItem.keys(), ...Object.keys(draft.prices)])
  for (const itemId of itemIds) {
    const typed = draft.prices[itemId]
    const had = byItem.get(itemId)
    if (valid(typed)) {
      const x = draft.extras?.[itemId]
      const leadTime = itemLeadTime(draft, itemId) || null
      prices.push(x ? { itemId, unitPrice: typed, leadTime, weight: validWeight(x.weight), weightUnit: x.weightUnit, origin: x.origin.trim() || null } : { itemId, unitPrice: typed, leadTime })
      if (had && had.currency !== draft.currency) removeItemIds.push(itemId)
    } else if (had) {
      removeItemIds.push(itemId)
    }
  }
  return { prices, removeItemIds, leadTime: draft.leadTime.trim() || null, inStock: draft.inStock }
}

/** The row holds something that is not yet saved. */
export function isReplyDirty(existing: readonly ExistingLine[], draft: ReplyDraft): boolean {
  const plan = planReplySave(existing, draft)
  if (plan.removeItemIds.length > 0) return true
  const byItem = new Map(existing.map(l => [l.itemId, l]))
  for (const p of plan.prices) {
    const had = byItem.get(p.itemId)
    if (!had || had.unitPrice !== p.unitPrice) return true
    if ((had.leadTime ?? null) !== (p.leadTime ?? null) || (had.inStock ?? null) !== plan.inStock) return true
    if (p.weight !== undefined && ((had.weight ?? null) !== p.weight || (p.weight !== null && (had.weightUnit ?? 'kg') !== p.weightUnit))) return true
    if (p.origin !== undefined && (had.origin?.trim() || null) !== p.origin) return true
  }
  return false
}

/** The row's starting values from what is already saved: the first line's currency and stock, and each line's own lead time. */
export function draftFromLines(existing: readonly ExistingLine[], fallbackCurrency: string): ReplyDraft {
  const prices: Record<string, number> = {}
  const extras: Record<string, ItemExtras> = {}
  const leadTimes: Record<string, string> = {}
  for (const l of existing) {
    prices[l.itemId] = l.unitPrice
    leadTimes[l.itemId] = l.leadTime ?? ''
    if (l.weight != null || l.origin) extras[l.itemId] = { weight: l.weight ?? null, weightUnit: l.weightUnit ?? 'kg', origin: l.origin ?? '' }
  }
  const first = existing[0]
  return {
    currency: first?.currency ?? fallbackCurrency,
    prices,
    // No row lead time: each saved line brings its own, and an item priced now is asked for its own rather than given another's.
    leadTime: '',
    ...(existing.length > 0 ? { leadTimes } : {}),
    inStock: first?.inStock ?? null,
    ...(Object.keys(extras).length > 0 ? { extras } : {}),
  }
}
