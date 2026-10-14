// R07: what saving one supplier's reply row writes. Pure, so the rules are tested without a screen.
//
//  - A price typed (greater than zero) becomes a quote line for that item, in the row's currency.
//  - A line that already exists is updated in place when its currency is unchanged.
//  - A line whose currency changed is removed and entered again, so the database captures today's rate for the new currency
//    (the capture trigger only runs on insert).
//  - A price that was cleared removes its line. A blank item that never had a line writes nothing.

export interface ExistingLine {
  itemId: string
  unitPrice: number
  currency: string
  leadTime: string | null
  inStock: boolean | null
}

export interface ReplyDraft {
  /** The row's currency, pre-filled and rarely changed. */
  currency: string
  /** Price typed per item id. Null or missing: nothing typed. */
  prices: Readonly<Record<string, number | null | undefined>>
  leadTime: string
  inStock: boolean | null
}

export interface ReplyPlan {
  prices: Array<{ itemId: string; unitPrice: number }>
  removeItemIds: string[]
  leadTime: string | null
  inStock: boolean | null
}

const valid = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

export function planReplySave(existing: readonly ExistingLine[], draft: ReplyDraft): ReplyPlan {
  const byItem = new Map(existing.map(l => [l.itemId, l]))
  const prices: ReplyPlan['prices'] = []
  const removeItemIds: string[] = []
  const itemIds = new Set([...byItem.keys(), ...Object.keys(draft.prices)])
  for (const itemId of itemIds) {
    const typed = draft.prices[itemId]
    const had = byItem.get(itemId)
    if (valid(typed)) {
      prices.push({ itemId, unitPrice: typed })
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
    if ((had.leadTime ?? null) !== plan.leadTime || (had.inStock ?? null) !== plan.inStock) return true
  }
  return false
}

/** The row's starting values from what is already saved: the first line's currency, lead time and stock. */
export function draftFromLines(existing: readonly ExistingLine[], fallbackCurrency: string): ReplyDraft {
  const prices: Record<string, number> = {}
  for (const l of existing) prices[l.itemId] = l.unitPrice
  const first = existing[0]
  return { currency: first?.currency ?? fallbackCurrency, prices, leadTime: first?.leadTime ?? '', inStock: first?.inStock ?? null }
}
