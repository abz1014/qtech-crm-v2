// "Fill missing categories" (C5): run the keyword dictionary over the rfq_items and order_items that have no category, show how many
// would go to each category, then write them in batches of 200. Pure: the page reads the rows and writes the batches.
//   - Only a SURE answer is applied (dictionary.ts confidence 'sure'); an unsure one (two categories tied, or two that are easy to
//     confuse) and a description the dictionary does not know are counted and left alone.
//   - A category the dictionary names that is not on file as a curated category is counted as "no category on file", not invented.
import { inferCategory } from '@/lib/categories/dictionary'

export const BATCH_SIZE = 200

export interface ItemToFill {
  id: string
  description: string
}

export interface CategoryOption {
  id: string
  name: string
}

export interface FillGroup {
  familyId: string
  name: string
  rfqItemIds: string[]
  orderItemIds: string[]
}

export interface FillPlan {
  groups: FillGroup[]
  /** Items the dictionary was unsure about (two categories fit). */
  unsure: number
  /** Items it did not recognise, or named a category that is not on file. */
  unknown: number
  /** Items that would be filled: the sum of the groups. */
  total: number
  /** Items looked at. */
  scanned: number
}

export function planFill(rfqItems: readonly ItemToFill[], orderItems: readonly ItemToFill[], families: readonly CategoryOption[]): FillPlan {
  const byName = new Map(families.map(f => [f.name.trim().toLocaleLowerCase('en'), f]))
  const groups = new Map<string, FillGroup>()
  let unsure = 0
  let unknown = 0
  const place = (it: ItemToFill, table: 'rfq' | 'order') => {
    const guess = inferCategory(it.description)
    if (guess.confidence === 'unsure') {
      unsure += 1
      return
    }
    const fam = guess.confidence === 'sure' && guess.name ? byName.get(guess.name.trim().toLocaleLowerCase('en')) : undefined
    if (!fam) {
      unknown += 1
      return
    }
    const g = groups.get(fam.id) ?? { familyId: fam.id, name: fam.name, rfqItemIds: [], orderItemIds: [] }
    ;(table === 'rfq' ? g.rfqItemIds : g.orderItemIds).push(it.id)
    groups.set(fam.id, g)
  }
  for (const it of rfqItems) place(it, 'rfq')
  for (const it of orderItems) place(it, 'order')
  const list = [...groups.values()].sort((a, b) => b.rfqItemIds.length + b.orderItemIds.length - (a.rfqItemIds.length + a.orderItemIds.length) || a.name.localeCompare(b.name))
  return {
    groups: list,
    unsure,
    unknown,
    total: list.reduce((n, g) => n + g.rfqItemIds.length + g.orderItemIds.length, 0),
    scanned: rfqItems.length + orderItems.length,
  }
}

export interface FillBatch {
  table: 'rfq_items' | 'order_items'
  familyId: string
  name: string
  ids: string[]
}

/** The writes, in batches of at most 200 ids, RFQ items first, one category at a time (the largest first). */
export function fillBatches(plan: FillPlan, size: number = BATCH_SIZE): FillBatch[] {
  const out: FillBatch[] = []
  for (const table of ['rfq_items', 'order_items'] as const) {
    for (const g of plan.groups) {
      const ids = table === 'rfq_items' ? g.rfqItemIds : g.orderItemIds
      for (let i = 0; i < ids.length; i += size) out.push({ table, familyId: g.familyId, name: g.name, ids: ids.slice(i, i + size) })
    }
  }
  return out
}

/** "412 items in 9 categories", for the preview's summary line. */
export function planSummary(plan: FillPlan): string {
  const n = plan.groups.length
  return `${plan.total} ${plan.total === 1 ? 'item' : 'items'} in ${n} ${n === 1 ? 'category' : 'categories'}`
}
