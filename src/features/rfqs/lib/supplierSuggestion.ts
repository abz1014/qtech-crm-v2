// R03: supplier suggestion for the intake float screen. Pure and framework-free.
//
// Rules (DATA_MODEL 5c, Amendments A2 and A2b; BUILD_PLAN R03; DECISIONS F-7):
//  - Every suggestion carries a plain-language reason. There is no score, no weight and no percentage.
//  - The reasons form three groups, always in this order:
//      1. supplied_before   "Supplied this item before": a tier 0 / tier 1 match on a past leg with this supplier
//                           (supplier_item_memory().supplied_before). The ONLY group that is pre-ticked.
//      2. carries_brand     the supplier's company_brands include the brand of at least one item
//      3. family_shortlist  the supplier's company_brands include the family of at least one item
//    A supplier takes the strongest group it qualifies for across all items. A supplier that qualifies for none is
//    not suggested.
//  - Order: group, then most recent contact (newest first, never-contacted last), then name (case-insensitive),
//    then id so the result is total and deterministic. Memory statistics (asked/replied/median days/chosen/late,
//    match tier 0 vs 1) NEVER enter the ordering: they only fill the memory line. A test pins this.

import { monthYear, shortDay } from './dateText'

// ------------------------------------------------------------------------------------------------ input shapes

/** One RFQ item as the float screen holds it. Names are optional display text; ids drive the matching. */
export interface SuggestionItem {
  id: string
  description: string
  brandId: string | null
  brandName?: string | null
  familyId: string | null
  familyName?: string | null
  /** rfq_items.model_tokens, e.g. ['HQ1110']. Only used to name the model in the reason. */
  modelTokens?: readonly string[] | null
}

/** The columns of v_supplier_stats that this module reads (nullable: a company with no activity has NULLs). */
export interface SupplierStatsRow {
  supplier_id: string
  asked: number | null
  replied: number | null
  no_offer?: number | null
  median_reply_days: number | null
  last_contact: string | null
  /** company_brands: brand ids AND family ids, aligned with brand_names. */
  brand_ids: readonly string[] | null
  brand_names?: readonly string[] | null
}

/** A candidate supplier: the company row plus its v_supplier_stats row (null when the view has none). */
export interface SupplierRecord {
  id: string
  name: string
  city?: string | null
  stats: SupplierStatsRow | null
}

/** The columns of supplier_item_memory() that this module reads. */
export interface SupplierItemMemoryRow {
  supplier_id: string
  best_tier: number | null
  supplied_before: boolean | null
  last_ordered_on?: string | null
  last_po_on?: string | null
}

export interface SupplierHistory {
  suppliers: readonly SupplierRecord[]
  /** supplier_item_memory() result per item, keyed by SuggestionItem.id. A missing key means "no memory loaded". */
  memory: Readonly<Record<string, readonly SupplierItemMemoryRow[] | undefined>>
}

export interface SuggestOptions {
  /** Today (YYYY-MM-DD, business timezone). Only used to decide whether a date needs its year. */
  today?: string | null
}

// ------------------------------------------------------------------------------------------------ output shapes

export type SuggestionGroup = 'supplied_before' | 'carries_brand' | 'family_shortlist'

export const GROUP_ORDER: readonly SuggestionGroup[] = ['supplied_before', 'carries_brand', 'family_shortlist']

/** Group headings, as in the approved intake mockup. */
export const GROUP_LABEL: Record<SuggestionGroup, string> = {
  supplied_before: 'Supplied this item before',
  carries_brand: 'Carries a brand in this RFQ',
  family_shortlist: 'Shortlisted for the family',
}

export type TierLabel = 'same model' | 'same item' | 'same brand' | 'same family'

export interface SupplierSuggestion {
  supplierId: string
  name: string
  city: string | null
  group: SuggestionGroup
  groupLabel: string
  /** True only for supplied_before. */
  preTicked: boolean
  /** Neutral label shown beside the name. */
  tierLabel: TierLabel
  /** Plain-language reason for the suggestion. */
  reason: string
  /** Facts from v_supplier_stats as counts, e.g. "answered 7 of 8 · usually replies in ~1 day · last contacted 3 Nov". */
  memoryLine: string
  /** Items for which this supplier qualified under its group (in item order). */
  coversItemIds: string[]
  /** v_supplier_stats.last_contact (YYYY-MM-DD) or null. The only statistic the ranking looks at. */
  lastContact: string | null
}

export interface SuggestionGroupResult {
  group: SuggestionGroup
  label: string
  suppliers: SupplierSuggestion[]
}

export interface SuggestionResult {
  /** All suggestions, ranked: group, then recency, then name. */
  suppliers: SupplierSuggestion[]
  /** The same suppliers split by group; empty groups are omitted. */
  groups: SuggestionGroupResult[]
  /** Supplier ids to tick when the screen opens (supplied_before only). */
  preTickedIds: string[]
  /** Items that no pre-ticked supplier covers (the float screen flags them, never blocks). */
  itemsWithoutTickedSupplier: string[]
  /** Items that no suggestion of any group covers. */
  itemsWithoutAnySuggestion: string[]
}

// ------------------------------------------------------------------------------------------------ helpers

function dateKey(d: string | null | undefined): string | null {
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null
}

/** "Hach HQ1110": brand plus the model code as the customer wrote it; else the description cut to a readable length. */
export function itemLabel(item: SuggestionItem): string {
  const token = item.modelTokens?.[0]
  if (token) {
    const asWritten = item.description
      .split(/[\s,]+/)
      .find((w) => w.toUpperCase().replace(/[-./]/g, '') === token)
    const model = asWritten ?? token
    const brand = item.brandName?.trim()
    return brand && !model.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${model}` : model
  }
  const d = item.description.replace(/\s+/g, ' ').trim()
  return d.length > 40 ? `${d.slice(0, 39).trimEnd()}…` : d
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** The memory line of the mockup, built from counts only (DATA_MODEL 5c display rules). */
export function memoryLine(stats: SupplierStatsRow | null, today?: string | null): string {
  const asked = stats?.asked ?? 0
  const replied = stats?.replied ?? 0
  const parts: string[] = []
  if (asked <= 0) {
    parts.push('no history yet')
  } else if (asked < 3) {
    // Below 3 asks: raw facts only, no rate and no usual reply time.
    const a = asked === 1 ? 'asked once' : 'asked twice'
    const r = replied === 0 ? 'no reply' : replied === 1 ? '1 reply' : `${replied} replies`
    parts.push(`${a}, ${r}`)
  } else {
    parts.push(`answered ${replied} of ${asked}`)
    const median = stats?.median_reply_days
    if (median != null) {
      const days = Math.round(median)
      parts.push(days < 1 ? 'usually replies the same day' : `usually replies in ~${days} ${days === 1 ? 'day' : 'days'}`)
    }
  }
  const last = dateKey(stats?.last_contact)
  if (last) parts.push(`last contacted ${shortDay(last, today)}`)
  return parts.join(' · ')
}

function bestOrderedDate(rows: SupplierItemMemoryRow[]): string | null {
  let best: string | null = null
  for (const r of rows) {
    const d = dateKey(r.last_ordered_on) ?? dateKey(r.last_po_on)
    if (d && (best === null || d > best)) best = d
  }
  return best
}

function compareSuggestions(a: SupplierSuggestion, b: SupplierSuggestion): number {
  const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
  if (g !== 0) return g
  // Most recent contact first; a supplier never contacted sorts after every contacted one.
  if (a.lastContact !== b.lastContact) {
    if (a.lastContact === null) return 1
    if (b.lastContact === null) return -1
    return a.lastContact < b.lastContact ? 1 : -1
  }
  const an = a.name.toLocaleLowerCase('en')
  const bn = b.name.toLocaleLowerCase('en')
  if (an !== bn) return an < bn ? -1 : 1
  return a.supplierId < b.supplierId ? -1 : a.supplierId > b.supplierId ? 1 : 0
}

// ------------------------------------------------------------------------------------------------ main

export function suggestSuppliers(
  items: readonly SuggestionItem[],
  history: SupplierHistory,
  options: SuggestOptions = {},
): SuggestionResult {
  const today = options.today ?? null
  const out: SupplierSuggestion[] = []
  const seen = new Set<string>()

  for (const sup of history.suppliers) {
    if (seen.has(sup.id)) continue // a duplicated candidate is listed once
    seen.add(sup.id)

    // Group 1: supplied before (tier 0 or 1 on a leg, as decided by supplier_item_memory()).
    const supplied: { item: SuggestionItem; row: SupplierItemMemoryRow }[] = []
    for (const item of items) {
      const row = history.memory[item.id]?.find((r) => r.supplier_id === sup.id)
      if (row && row.supplied_before === true && row.best_tier != null && row.best_tier <= 1) supplied.push({ item, row })
    }

    const carried = sup.stats?.brand_ids ?? []
    const brandHits = items.filter((i) => i.brandId != null && carried.includes(i.brandId))
    const familyHits = items.filter((i) => i.familyId != null && carried.includes(i.familyId))

    let group: SuggestionGroup
    let covers: SuggestionItem[]
    let tier: TierLabel
    let reason: string

    if (supplied.length > 0) {
      group = 'supplied_before'
      covers = supplied.map((s) => s.item)
      tier = supplied.some((s) => s.row.best_tier === 0) ? 'same model' : 'same item'
      const names = covers.map(itemLabel)
      const shown = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names
      const last = bestOrderedDate(supplied.map((s) => s.row))
      reason = `Supplied this item before: ${joinList(shown)}${last ? `, last ordered ${monthYear(last)}` : ''}.`
    } else if (brandHits.length > 0) {
      group = 'carries_brand'
      covers = brandHits
      tier = 'same brand'
      const names: string[] = []
      for (const i of brandHits) {
        const idx = carried.indexOf(i.brandId as string)
        const n = i.brandName?.trim() || sup.stats?.brand_names?.[idx]?.trim() || 'a brand in this RFQ'
        if (!names.includes(n)) names.push(n)
      }
      reason = `Carries ${joinList(names)}.`
    } else if (familyHits.length > 0) {
      group = 'family_shortlist'
      covers = familyHits
      tier = 'same family'
      const names: string[] = []
      for (const i of familyHits) {
        const idx = carried.indexOf(i.familyId as string)
        const n = (i.familyName?.trim() || sup.stats?.brand_names?.[idx]?.trim() || '').toLocaleLowerCase('en')
        if (n && !names.includes(n)) names.push(n)
      }
      reason = names.length > 0 ? `On your ${joinList(names)} shortlist.` : 'On your shortlist for this item family.'
    } else {
      continue
    }

    out.push({
      supplierId: sup.id,
      name: sup.name,
      city: sup.city ?? null,
      group,
      groupLabel: GROUP_LABEL[group],
      preTicked: group === 'supplied_before',
      tierLabel: tier,
      reason,
      memoryLine: memoryLine(sup.stats, today),
      coversItemIds: items.filter((i) => covers.includes(i)).map((i) => i.id),
      lastContact: dateKey(sup.stats?.last_contact),
    })
  }

  out.sort(compareSuggestions)

  const groups: SuggestionGroupResult[] = []
  for (const g of GROUP_ORDER) {
    const list = out.filter((s) => s.group === g)
    if (list.length > 0) groups.push({ group: g, label: GROUP_LABEL[g], suppliers: list })
  }

  const ticked = out.filter((s) => s.preTicked)
  return {
    suppliers: out,
    groups,
    preTickedIds: ticked.map((s) => s.supplierId),
    itemsWithoutTickedSupplier: items.filter((i) => !ticked.some((s) => s.coversItemIds.includes(i.id))).map((i) => i.id),
    itemsWithoutAnySuggestion: items.filter((i) => !out.some((s) => s.coversItemIds.includes(i.id))).map((i) => i.id),
  }
}
