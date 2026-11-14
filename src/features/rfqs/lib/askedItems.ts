/*
 * Which items a supplier was asked about (supplier flow D, 0140). supplier_inquiries.asked_item_ids lists them; NULL means every
 * item of the RFQ, which is what every inquiry meant before 0140, so an old ask still reads as asked about everything. An id of an
 * item removed later stays in the list and is simply not among the RFQ's items any more.
 */

/** The part of an inquiry these rules read. Absent or null `askedItemIds`: asked about every item. */
export interface AskedScope {
  askedItemIds?: readonly string[] | null
}

/** Was this supplier asked about this item? */
export function askedAbout(inquiry: AskedScope, itemId: string): boolean {
  return !inquiry.askedItemIds || inquiry.askedItemIds.includes(itemId)
}

/** The RFQ's items this supplier was asked about, in the RFQ's order. */
export function askedItemsOf<T extends { id: string }>(inquiry: AskedScope, items: readonly T[]): T[] {
  return items.filter(it => askedAbout(inquiry, it.id))
}

/**
 * What to store for an ask about `chosen`: null (every item) when the choice covers every item of the RFQ, else the chosen ids in
 * the RFQ's order. `all` undefined (the item list has not loaded): the chosen ids, never a guess of "every item".
 */
export function scopeFor(chosen: readonly string[], all: readonly string[] | undefined): string[] | null {
  if (all !== undefined && all.every(id => chosen.includes(id))) return null
  const order = all ?? chosen
  return [...order.filter(id => chosen.includes(id)), ...chosen.filter(id => !order.includes(id))]
}

/**
 * The scope after asking a supplier already asked: the union of what they were asked before and now. Null (every item) stays
 * null, and a union that covers every item becomes null.
 */
export function widenScope(current: readonly string[] | null | undefined, asked: readonly string[] | null, all: readonly string[] | undefined): string[] | null {
  if (!current || asked === null) return null
  return scopeFor([...current, ...asked.filter(id => !current.includes(id))], all)
}

/** True when two scopes say the same thing (null equals null; lists compared as sets). */
export function sameScope(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.length === b.length && a.every(id => b.includes(id))
}

/** "item 2", "items 1 and 2", "items 1, 2 and 3", in number order. */
export function numbersText(nums: readonly number[]): string {
  const n = [...nums].sort((a, b) => a - b)
  if (n.length === 0) return ''
  if (n.length === 1) return `item ${n[0]}`
  if (n.length === 2) return `items ${n[0]} and ${n[1]}`
  return `items ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

/**
 * "Asked about items 1 and 2 only" (no full stop): said only for a supplier asked about some of the items. Null when they were
 * asked about every item.
 */
export function askedAboutText(inquiry: AskedScope, items: readonly { id: string; number: number }[]): string | null {
  if (!inquiry.askedItemIds) return null
  const asked = askedItemsOf(inquiry, items)
  if (asked.length === items.length) return null
  return asked.length === 0 ? 'Asked about an item that was removed' : `Asked about ${numbersText(asked.map(it => it.number))} only`
}
