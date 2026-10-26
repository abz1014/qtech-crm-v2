// R03 / C3: supplier suggestion for the intake float screen and "Ask more suppliers". Pure and framework-free.
//
// Ranking v2 (owner task C3; DATA_MODEL 5c, Amendments A2, A2b and A8 are superseded where they differ):
//  - Every suggestion carries a plain-language reason. There is no score, no weight and no percentage.
//  - The category of an item is its family_id; where that is null the keyword dictionary (src/lib/categories/dictionary.ts) names
//    one. That is a GUESS: withCategories() marks it (`categoryGuessed`) and the screens draw it dashed.
//  - Groups, always in this order:
//      1. deals_in         "Deals in <category>": a manual tag (company_brands carries the category) or quoted/ordered at least
//                          once in it (v_supplier_category_evidence). One group per category of the RFQ; a supplier sits in the
//                          category it has the most to show for.
//      2. carries_brand    "Carries <brand>": company_brands includes the brand of an item.
//      3. supplied_before  only for a supplier that qualifies for neither 1 nor 2 but supplied the exact item before.
//    "Supplied this item before" (tier 0 or 1 on a past leg, supplier_item_memory()) is a BADGE on any suggestion, not a group.
//  - Order inside a group: ordered count, then the category's reply rate, then the overall reply rate, then price wins (admin and
//    sales only: NULL for an engineer), then the most recent contact, then name, then id. A supplier that declared no offer on at
//    least 2 of its last 3 asks is demoted: after every other supplier of its group, still listed.
//  - Pre-ticked: the first 3 of the ranked list whose reply rate is 50% or more (the category's, else the overall rate), or that
//    carry a manual tag, or that supplied this item before; never a demoted one.
//  - Every key is a count and is printed (the reason, the memory line); there is no score.

import { monthYear, shortDay } from './dateText'
import { evidenceOf, evidenceReason, recordFromStats, type Evidence, type Reason } from './ranking/reasons'
import { inferCategory } from '@/lib/categories/dictionary'
import type { MemoryRow, MemoryStats } from '@/lib/memory'

// ------------------------------------------------------------------------------------------------ input shapes

/** One RFQ item as the float screen holds it. Names are optional display text; ids drive the matching. */
export interface SuggestionItem {
  id: string
  description: string
  brandId: string | null
  brandName?: string | null
  /** The item's category (a brands row of kind family). Null until withCategories() guesses one. */
  familyId: string | null
  familyName?: string | null
  /** True when familyId/familyName came from the keyword dictionary, not from the item: shown dashed. */
  categoryGuessed?: boolean
  /** rfq_items.model_tokens, e.g. ['HQ1110']. Only used to name the model in the reason. */
  modelTokens?: readonly string[] | null
}

/** The columns of v_supplier_stats that this module reads (nullable: a company with no activity has NULLs). The memory card reads the rest. */
export interface SupplierStatsRow extends MemoryStats {
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

/** One row of supplier_item_memory(): the suggestion reads best_tier and supplied_before, the memory card reads the rest. */
export type SupplierItemMemoryRow = MemoryRow

/** One row of v_supplier_category_evidence (0093): counts only, the same for every role. */
export interface CategoryEvidenceRow {
  supplier_id: string
  family_id: string
  asked: number
  replied: number
  quoted: number
  no_offer: number
  ordered: number
  last_asked_on?: string | null
}

/** One row of supplier_category_price_wins (0093): wins and of_ranked are NULL unless the caller is admin or sales. */
export interface PriceWinsRow {
  supplier_id: string
  family_id: string
  wins: number | null
  of_ranked: number | null
}

/** How one ask ended, newest first per supplier: 'no_offer' (declared no offer, nothing quoted) or 'other'. */
export type AskOutcome = 'no_offer' | 'other'

export interface SupplierHistory {
  suppliers: readonly SupplierRecord[]
  /** supplier_item_memory() result per item, keyed by SuggestionItem.id. A missing key means "no memory loaded". */
  memory: Readonly<Record<string, readonly SupplierItemMemoryRow[] | undefined>>
  /** v_supplier_category_evidence for the categories of the items. Missing: the category groups rest on manual tags alone. */
  categoryEvidence?: readonly CategoryEvidenceRow[]
  /** supplier_category_price_wins for the same categories (admin and sales; empty or NULL counts for an engineer). */
  priceWins?: readonly PriceWinsRow[]
  /** Each supplier's most recent asks, newest first (three are read): the demotion rule. */
  recentAsks?: Readonly<Record<string, readonly AskOutcome[]>>
}

export interface SuggestOptions {
  /** Today (YYYY-MM-DD, business timezone). Only used to decide whether a date needs its year. */
  today?: string | null
}

// ------------------------------------------------------------------------------------------------ output shapes

export type SuggestionGroup = 'deals_in' | 'carries_brand' | 'supplied_before'

export const GROUP_ORDER: readonly SuggestionGroup[] = ['deals_in', 'carries_brand', 'supplied_before']

/** Group headings for the groups that name no category or brand (the others are built: "Deals in contactors"). */
export const GROUP_LABEL: Record<SuggestionGroup, string> = {
  deals_in: 'Deals in this category',
  carries_brand: 'Carries a brand in this RFQ',
  supplied_before: 'Supplied this item before',
}

export type TierLabel = 'same model' | 'same item' | 'same brand' | 'same family'

export interface SupplierSuggestion {
  supplierId: string
  name: string
  city: string | null
  group: SuggestionGroup
  groupLabel: string
  /** Key of the group the supplier sits in ("deals_in:<familyId>", "carries_brand", "supplied_before"). */
  groupKey: string
  /** Ticked when the screen opens: the top three with a reply rate of 50% or more, a manual tag, or an earlier supply. */
  preTicked: boolean
  /** Neutral label shown beside the name. */
  tierLabel: TierLabel
  /** Plain-language reason, as the ask dialog shows it: "Deals in contactors: quoted 5 of 6". */
  reason: string
  /** Facts from v_supplier_stats as counts, e.g. "answered 7 of 8 · usually replies in ~1 day · last contacted 3 Nov". */
  memoryLine: string
  /** Items for which this supplier qualified (in item order). */
  coversItemIds: string[]
  /** v_supplier_stats.last_contact (YYYY-MM-DD) or null. */
  lastContact: string | null
  /** The delivery record from v_supplier_stats ("on time 5 of 6 deliveries"); null when the supplier has no delivery on record. */
  record: Reason | null
  /** The newest order at the strongest tier of the match, in the owner's words (order number, placed date, delivered after N days). Null when none. */
  evidence: Reason | null
  /** The whole v_supplier_stats row, for the memory card only. */
  stats: SupplierStatsRow | null
  /** The badge "Supplied this item before" (tier 0 or 1 on a past leg). */
  suppliedBefore: boolean
  /** The supplier carries the category as a tag (company_brands): set by hand or learned from its quotes. */
  manualTag: boolean
  /** No offer on at least 2 of the last 3 asks: listed after the others of its group, never ticked. */
  demoted: boolean
  /** The category the supplier was placed under (deals_in only). */
  categoryId: string | null
  categoryName: string | null
}

export interface SuggestionGroupResult {
  group: SuggestionGroup
  /** Unique key of the group ("deals_in:<familyId>"). */
  key: string
  label: string
  suppliers: SupplierSuggestion[]
}

export interface SuggestionResult {
  /** All suggestions, ranked: group, then the keys above. */
  suppliers: SupplierSuggestion[]
  /** The same suppliers split by group; empty groups are omitted. */
  groups: SuggestionGroupResult[]
  /** Supplier ids to tick when the screen opens. */
  preTickedIds: string[]
  /** Items that no pre-ticked supplier covers (the float screen flags them, never blocks). */
  itemsWithoutTickedSupplier: string[]
  /** Items that no suggestion of any group covers. */
  itemsWithoutAnySuggestion: string[]
  /** Categories of the items that no candidate supplier deals in (the coverage line). */
  uncovered: { categoryId: string; name: string; guessed: boolean }[]
}

/** How many suppliers are ticked at most. */
export const PRE_TICK_MAX = 3
/** The reply rate, as a percentage, that earns a tick. */
export const PRE_TICK_MIN_RATE = 50

// ------------------------------------------------------------------------------------------------ categories

/** A category the app can name an item with: the curated brands rows of kind family. */
export interface CategoryOption {
  id: string
  name: string
}

/**
 * Fill the category of every item that has none from the keyword dictionary (a guess: `categoryGuessed`). A guess that is not sure,
 * or that names a category not on file, leaves the item without one. Items that already have a family are returned as they are.
 */
export function withCategories<T extends SuggestionItem>(items: readonly T[], families: readonly CategoryOption[]): T[] {
  const byName = new Map(families.map((f) => [f.name.trim().toLocaleLowerCase('en'), f]))
  return items.map((it) => {
    if (it.familyId) return it
    const guess = inferCategory(it.description)
    const fam = guess.confidence === 'sure' && guess.name ? byName.get(guess.name.trim().toLocaleLowerCase('en')) : undefined
    return fam ? { ...it, familyId: fam.id, familyName: fam.name, categoryGuessed: true } : it
  })
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
export function memoryLine(stats: SupplierStatsRow | null, today?: string | null, options: { hasEvidence?: boolean } = {}): string {
  const asked = stats?.asked ?? 0
  const replied = stats?.replied ?? 0
  const ordered = stats?.orders_count ?? 0
  const parts: string[] = []
  // "ordered from 4 times" comes first once there is an order (g2-ranking-split.html, Float).
  if (ordered > 0) parts.push(`ordered from ${ordered === 1 ? 'once' : `${ordered} times`}`)
  if (asked <= 0) {
    if (ordered <= 0) parts.push('no history yet')
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
  // The order evidence line replaces "last contacted" wherever an order is cited.
  const last = options.hasEvidence ? null : dateKey(stats?.last_contact)
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

/** The best order evidence among the rows of the items a supplier was suggested for: the strongest tier, then the newest order. */
function bestEvidence(rows: { item: SuggestionItem; row: SupplierItemMemoryRow }[]): { ev: Evidence; item: SuggestionItem } | null {
  let best: { ev: Evidence; item: SuggestionItem } | null = null
  for (const { item, row } of rows) {
    const ev = evidenceOf(row)
    if (!ev) continue
    if (!best || ev.tier < best.ev.tier || (ev.tier === best.ev.tier && (ev.placedOn ?? '') > (best.ev.placedOn ?? ''))) best = { ev, item }
  }
  return best
}

const lower = (s: string) => s.trim().toLocaleLowerCase('en')

/** "quoted 5 of 6", "ordered 2", both, or "tagged" when there is nothing yet but the tag. */
function dealsFact(e: CategoryEvidenceRow | undefined): string {
  const parts: string[] = []
  if (e && e.asked > 0 && e.quoted > 0) parts.push(`quoted ${e.quoted} of ${e.asked}`)
  else if (e && e.quoted > 0) parts.push(`quoted ${e.quoted}`)
  if (e && e.ordered > 0) parts.push(`ordered ${e.ordered}`)
  return parts.join(', ')
}

/** A supplier's ratio as a whole-number percentage, or null with nothing asked. */
const ratePct = (replied: number | null | undefined, asked: number | null | undefined): number | null => (asked && asked > 0 ? Math.round(((replied ?? 0) * 100) / asked) : null)

/** No offer on at least 2 of the last 3 asks. */
export const isDemoted = (recent: readonly AskOutcome[] | undefined): boolean => (recent ?? []).slice(0, 3).filter((o) => o === 'no_offer').length >= 2

interface Keys {
  ordered: number
  catRate: number
  overallRate: number
  wins: number
}

// ------------------------------------------------------------------------------------------------ main

export function suggestSuppliers(items: readonly SuggestionItem[], history: SupplierHistory, options: SuggestOptions = {}): SuggestionResult {
  const today = options.today ?? null
  const evidence = new Map<string, CategoryEvidenceRow>()
  for (const e of history.categoryEvidence ?? []) evidence.set(`${e.supplier_id}|${e.family_id}`, e)
  const wins = new Map<string, PriceWinsRow>()
  for (const w of history.priceWins ?? []) wins.set(`${w.supplier_id}|${w.family_id}`, w)

  const categories = new Map<string, { name: string; guessed: boolean }>()
  for (const i of items) {
    if (!i.familyId) continue
    const known = categories.get(i.familyId)
    categories.set(i.familyId, { name: i.familyName?.trim() || known?.name || 'this category', guessed: (known ? known.guessed : true) && Boolean(i.categoryGuessed) })
  }

  const out: SupplierSuggestion[] = []
  const keys = new Map<SupplierSuggestion, Keys>()
  const seen = new Set<string>()

  for (const sup of history.suppliers) {
    if (seen.has(sup.id)) continue // a duplicated candidate is listed once
    seen.add(sup.id)
    const carried = sup.stats?.brand_ids ?? []

    // The badge: tier 0 or 1 on a leg, as decided by supplier_item_memory().
    const supplied: { item: SuggestionItem; row: SupplierItemMemoryRow }[] = []
    for (const item of items) {
      const row = history.memory[item.id]?.find((r) => r.supplier_id === sup.id)
      if (row && row.supplied_before === true && row.best_tier != null && row.best_tier <= 1) supplied.push({ item, row })
    }

    // Group 1: the categories the supplier deals in: a tag, or quoted or ordered at least once.
    const dealCats: { id: string; e: CategoryEvidenceRow | undefined; tag: boolean }[] = []
    for (const [id] of categories) {
      const e = evidence.get(`${sup.id}|${id}`)
      const tag = carried.includes(id)
      if (tag || (e && (e.quoted > 0 || e.ordered > 0))) dealCats.push({ id, e, tag })
    }
    const brandHits = items.filter((i) => i.brandId != null && carried.includes(i.brandId))

    let group: SuggestionGroup
    let groupKey: string
    let covers: SuggestionItem[]
    let tier: TierLabel
    let reason: string
    let catId: string | null = null
    let catName: string | null = null
    let catRow: CategoryEvidenceRow | undefined
    let manualTag = false

    if (dealCats.length > 0) {
      // The category it has the most to show for: ordered, then quoted, then a tag, then the order of the items.
      const best = [...dealCats].sort((a, b) => (b.e?.ordered ?? 0) - (a.e?.ordered ?? 0) || (b.e?.quoted ?? 0) - (a.e?.quoted ?? 0) || Number(b.tag) - Number(a.tag))[0]
      group = 'deals_in'
      catId = best.id
      catName = categories.get(best.id)?.name ?? 'this category'
      catRow = best.e
      manualTag = dealCats.some((d) => d.tag)
      groupKey = `deals_in:${best.id}`
      covers = items.filter((i) => i.familyId != null && dealCats.some((d) => d.id === i.familyId))
      tier = 'same family'
      const fact = dealsFact(catRow)
      reason = `Deals in ${lower(catName)}: ${fact || (best.tag ? 'on your list for it' : 'no history yet')}`
    } else if (brandHits.length > 0) {
      group = 'carries_brand'
      groupKey = 'carries_brand'
      covers = brandHits
      tier = 'same brand'
      const names: string[] = []
      for (const i of brandHits) {
        const idx = carried.indexOf(i.brandId as string)
        const n = i.brandName?.trim() || sup.stats?.brand_names?.[idx]?.trim() || 'a brand in this RFQ'
        if (!names.includes(n)) names.push(n)
      }
      reason = `Carries ${joinList(names)}`
    } else if (supplied.length > 0) {
      group = 'supplied_before'
      groupKey = 'supplied_before'
      covers = supplied.map((s) => s.item)
      tier = supplied.some((s) => s.row.best_tier === 0) ? 'same model' : 'same item'
      const names = covers.map(itemLabel)
      const shown = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names
      const last = bestOrderedDate(supplied.map((s) => s.row))
      reason = `Supplied this item before: ${joinList(shown)}${last ? `, last ordered ${monthYear(last)}` : ''}`
    } else {
      continue
    }

    // Supplied before, as a badge, also joins what the supplier covers.
    if (supplied.length > 0 && group !== 'supplied_before') {
      covers = [...new Set([...covers, ...supplied.map((s) => s.item)])]
      tier = supplied.some((s) => s.row.best_tier === 0) ? 'same model' : tier
    }
    const demoted = isDemoted(history.recentAsks?.[sup.id])
    if (demoted) reason += ' · no offer on 2 of the last 3 asks'
    reason += '.'

    // The memory rows of the items this supplier was suggested for (any tier: a brand or family order is evidence too).
    const coveredRows = covers.flatMap((item) => {
      const row = history.memory[item.id]?.find((r) => r.supplier_id === sup.id)
      return row ? [{ item, row }] : []
    })
    const found = bestEvidence(coveredRows)
    const w = catId ? wins.get(`${sup.id}|${catId}`) : undefined
    const suggestion: SupplierSuggestion = {
      supplierId: sup.id,
      name: sup.name,
      city: sup.city ?? null,
      group,
      groupLabel: group === 'deals_in' ? `Deals in ${lower(catName ?? 'this category')}` : group === 'carries_brand' ? 'Carries a brand in this RFQ' : GROUP_LABEL[group],
      groupKey,
      preTicked: false,
      tierLabel: tier,
      reason,
      memoryLine: memoryLine(sup.stats, today, { hasEvidence: found !== null }),
      coversItemIds: items.filter((i) => covers.includes(i)).map((i) => i.id),
      lastContact: dateKey(sup.stats?.last_contact),
      record: recordFromStats(sup.stats),
      evidence: found ? evidenceReason(found.ev, { brand: found.item.brandName, family: found.item.familyName }) : null,
      stats: sup.stats,
      suppliedBefore: supplied.length > 0,
      manualTag,
      demoted,
      categoryId: catId,
      categoryName: catName,
    }
    out.push(suggestion)
    keys.set(suggestion, {
      ordered: catRow ? catRow.ordered : (sup.stats?.orders_count ?? found?.ev.count ?? 0),
      catRate: ratePct(catRow?.replied, catRow?.asked) ?? -1,
      overallRate: ratePct(sup.stats?.replied, sup.stats?.asked) ?? -1,
      wins: w?.wins ?? 0,
    })
  }

  // The group headings: one per category, in the order the categories first appear in the items.
  const catOrder = [...categories.keys()]
  const groupRank = (s: SupplierSuggestion) => GROUP_ORDER.indexOf(s.group) * 1000 + (s.categoryId ? catOrder.indexOf(s.categoryId) : 0)
  out.sort((a, b) => {
    const g = groupRank(a) - groupRank(b)
    if (g !== 0) return g
    if (a.demoted !== b.demoted) return a.demoted ? 1 : -1
    const ka = keys.get(a) as Keys
    const kb = keys.get(b) as Keys
    if (ka.ordered !== kb.ordered) return kb.ordered - ka.ordered
    if (ka.catRate !== kb.catRate) return kb.catRate - ka.catRate
    if (ka.overallRate !== kb.overallRate) return kb.overallRate - ka.overallRate
    if (ka.wins !== kb.wins) return kb.wins - ka.wins
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
  })

  // Pre-tick: the first three, in ranked order, with a reply rate of 50% or more, a manual tag or an earlier supply.
  let ticks = 0
  for (const s of out) {
    if (ticks >= PRE_TICK_MAX) break
    const k = keys.get(s) as Keys
    const rate = k.catRate >= 0 ? k.catRate : k.overallRate
    if (!s.demoted && (rate >= PRE_TICK_MIN_RATE || s.manualTag || s.suppliedBefore)) {
      s.preTicked = true
      ticks += 1
    }
  }

  const groups: SuggestionGroupResult[] = []
  for (const s of out) {
    const last = groups[groups.length - 1]
    if (last && last.key === s.groupKey) last.suppliers.push(s)
    else groups.push({ group: s.group, key: s.groupKey, label: s.groupLabel, suppliers: [s] })
  }

  const ticked = out.filter((s) => s.preTicked)
  const dealtIn = new Set(out.filter((s) => s.group === 'deals_in').flatMap((s) => (s.categoryId ? [s.categoryId] : [])))
  // a category counts as covered when any candidate deals in it, even if the supplier was placed under another category
  for (const sup of history.suppliers) {
    for (const [id] of categories) if ((sup.stats?.brand_ids ?? []).includes(id) || (evidence.get(`${sup.id}|${id}`)?.quoted ?? 0) > 0 || (evidence.get(`${sup.id}|${id}`)?.ordered ?? 0) > 0) dealtIn.add(id)
  }
  return {
    suppliers: out,
    groups,
    preTickedIds: ticked.map((s) => s.supplierId),
    itemsWithoutTickedSupplier: items.filter((i) => !ticked.some((s) => s.coversItemIds.includes(i.id))).map((i) => i.id),
    itemsWithoutAnySuggestion: items.filter((i) => !out.some((s) => s.coversItemIds.includes(i.id))).map((i) => i.id),
    uncovered: [...categories].filter(([id]) => !dealtIn.has(id)).map(([id, c]) => ({ categoryId: id, name: c.name, guessed: c.guessed })),
  }
}

/**
 * The coverage line: said when no candidate supplier deals in a category of the RFQ, so an empty list is explained and not a
 * mystery. Null when every category has a supplier (or the items have no category).
 */
export function coverageLine(uncovered: SuggestionResult['uncovered']): string | null {
  if (uncovered.length === 0) return null
  const names = joinList(uncovered.map((u) => lower(u.name)))
  return `No supplier on file deals in ${names} yet. Ask a few: their answers build the list.`
}
