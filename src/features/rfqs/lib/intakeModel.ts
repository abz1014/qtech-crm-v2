// R05: the pure rules of the intake screen: item rows, supplier ticks, the flag for an item nobody is asked about,
// the float payload and the RFQ-number placeholder in the draft. No React, no network.

import type { EnquiryItem } from './enquiryDraft'
import type { SuggestionItem, SupplierSuggestion } from './supplierSuggestion'
import { modelTokens, type BrandRef } from './parseItems'

/** One item row as the screen holds it. `key` is a client id; the database numbers the rows by position. */
export interface DraftItem {
  key: string
  description: string
  /** null while the field is empty; read as 1 when saving (qty defaults to 1). */
  qty: number | null
  unit: string
  brandId: string | null
  familyId: string | null
}

/** Rows with a description. A row left blank is ignored, not an error: nothing is required but one real item. */
export const realItems = (items: readonly DraftItem[]): DraftItem[] => items.filter(i => i.description.trim() !== '')

export const effectiveQty = (i: DraftItem): number => (i.qty != null && Number.isFinite(i.qty) && i.qty > 0 ? i.qty : 1)

export function toSuggestionItems(items: readonly DraftItem[], brands: readonly BrandRef[]): SuggestionItem[] {
  const byId = new Map(brands.map(b => [b.id, b.name]))
  return realItems(items).map(i => ({
    id: i.key,
    description: i.description.trim(),
    brandId: i.brandId,
    brandName: i.brandId ? (byId.get(i.brandId) ?? null) : null,
    familyId: i.familyId,
    familyName: i.familyId ? (byId.get(i.familyId) ?? null) : null,
    modelTokens: modelTokens(i.description),
  }))
}

export function toEnquiryItems(items: readonly DraftItem[], brands: readonly BrandRef[]): EnquiryItem[] {
  const byId = new Map(brands.map(b => [b.id, b.name]))
  return realItems(items).map(i => ({
    description: i.description.trim(),
    brandName: i.brandId ? (byId.get(i.brandId) ?? null) : null,
    qty: effectiveQty(i),
    unit: i.unit.trim() || null,
    spec: null, // there is no spec column; the draft leaves Spec visibly blank (R04)
  }))
}

/** The jsonb handed to float_rfq: only what the person gave, plus the two defaults (qty 1, GST 18). */
export interface FloatItemPayload {
  description: string
  qty: number
  unit?: string
  brand_id?: string
  family_id?: string
  gst_rate: number
}

export const DEFAULT_GST_RATE = 18

export function toFloatItems(items: readonly DraftItem[]): FloatItemPayload[] {
  return realItems(items).map(i => ({
    description: i.description.trim(),
    qty: effectiveQty(i),
    ...(i.unit.trim() ? { unit: i.unit.trim() } : {}),
    ...(i.brandId ? { brand_id: i.brandId } : {}),
    ...(i.familyId ? { family_id: i.familyId } : {}),
    gst_rate: DEFAULT_GST_RATE,
  }))
}

// ------------------------------------------------------------------------------------------------ ticks

/**
 * Who is ticked: the person's own choice where they made one, else the suggestion's own tick (only "supplied this
 * item before" starts ticked). Suppliers added by hand are always ticked until removed.
 */
export function tickedIds(
  suggestions: readonly SupplierSuggestion[],
  overrides: Readonly<Record<string, boolean>>,
  manualIds: readonly string[] = [],
): string[] {
  const out: string[] = []
  for (const s of suggestions) if (overrides[s.supplierId] ?? s.preTicked) out.push(s.supplierId)
  for (const id of manualIds) if ((overrides[id] ?? true) && !out.includes(id)) out.push(id)
  return out
}

/**
 * Items (by key) that no ticked supplier is asked about. A supplier the person added by hand counts for every item:
 * they chose it. This is a flag on screen, never a block.
 */
export function itemsWithoutSupplier(
  itemKeys: readonly string[],
  suggestions: readonly SupplierSuggestion[],
  ticked: readonly string[],
  manualIds: readonly string[] = [],
): string[] {
  if (ticked.some(id => manualIds.includes(id))) return []
  const covered = new Set<string>()
  for (const s of suggestions) if (ticked.includes(s.supplierId)) s.coversItemIds.forEach(k => covered.add(k))
  return itemKeys.filter(k => !covered.has(k))
}

// ------------------------------------------------------------------------------------------------ RFQ number

/**
 * The RFQ number does not exist until the RFQ is saved (the database numbers it), and the text is copied in the same
 * tap that saves. The draft carries this placeholder; the copy swaps in the real "RFQ-0185".
 */
export const RFQ_REF_PLACEHOLDER = 'RFQ-####'

export function fillRfqRef(text: string, ref: string): string {
  return text.split(RFQ_REF_PLACEHOLDER).join(ref)
}

/** What the clipboard gets: the body, with the subject line first for an email. */
export function copyText(draft: { subject: string | null; body: string }, ref: string): string {
  const body = fillRfqRef(draft.body, ref)
  return draft.subject ? `Subject: ${fillRfqRef(draft.subject, ref)}\n\n${body}` : body
}

/** "A, B and C" for a sentence. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
