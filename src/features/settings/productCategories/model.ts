// Settings > Product categories: the pure parts (what a filter shows, a name that is taken, the merge sentence).
import type { ProductCategory } from '@/features/settings/productCategories/api'

export type CategoryView = 'curated' | 'other' | 'all'

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en')

export function filterCategories(rows: readonly ProductCategory[], view: CategoryView, text: string): ProductCategory[] {
  const q = norm(text)
  return rows
    .filter(r => (view === 'all' ? true : view === 'curated' ? r.curated : !r.curated))
    .filter(r => !q || norm(r.name).includes(q))
    .sort((a, b) => Number(b.curated) - Number(a.curated) || a.name.localeCompare(b.name))
}

/** A category name is unique ignoring case and outer spaces (the database says so too: brands_name_key); the message, or null when it is fine. */
export function categoryNameError(name: string, rows: readonly Pick<ProductCategory, 'id' | 'name'>[], selfId: string): string | null {
  const n = norm(name)
  if (n === '') return 'Enter a name.'
  if (n.length > 80) return 'Use 80 characters or fewer.'
  if (rows.some(r => r.id !== selfId && norm(r.name) === n)) return 'A category with this name already exists. Merge them instead, or choose another name.'
  return null
}

/**
 * Suppliers per category: the distinct suppliers that are tagged with it (company_brands) or have been asked or ordered for it
 * (v_supplier_category_evidence). A supplier in both is counted once. `tagged` is the manual/learned tags alone (what a merge moves).
 */
export function countSuppliersByCategory(
  tags: readonly { brand_id: string; company_id: string }[],
  evidence: readonly { family_id: string; supplier_id: string }[],
): { suppliers: Map<string, number>; tagged: Map<string, number> } {
  const tagSets = new Map<string, Set<string>>()
  const allSets = new Map<string, Set<string>>()
  const add = (m: Map<string, Set<string>>, k: string, v: string) => {
    const s = m.get(k) ?? new Set<string>()
    s.add(v)
    m.set(k, s)
  }
  for (const t of tags) {
    add(tagSets, t.brand_id, t.company_id)
    add(allSets, t.brand_id, t.company_id)
  }
  for (const e of evidence) add(allSets, e.family_id, e.supplier_id)
  const size = (m: Map<string, Set<string>>) => new Map([...m].map(([k, v]) => [k, v.size] as const))
  return { suppliers: size(allSets), tagged: size(tagSets) }
}

export function mergeSentence(from: Pick<ProductCategory, 'name' | 'tagged'>, into: Pick<ProductCategory, 'name'>): string {
  const tags = from.tagged === 0 ? 'no supplier is tagged with it' : `${from.tagged} ${from.tagged === 1 ? 'supplier is' : 'suppliers are'} tagged with it`
  return `Every item and order line of "${from.name}" moves into "${into.name}", and ${tags}. "${from.name}" is then removed.`
}
