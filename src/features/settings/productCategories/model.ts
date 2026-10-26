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

export function mergeSentence(from: Pick<ProductCategory, 'name' | 'suppliers'>, into: Pick<ProductCategory, 'name'>): string {
  const tags = from.suppliers === 0 ? 'no supplier is tagged with it' : `${from.suppliers} ${from.suppliers === 1 ? 'supplier is' : 'suppliers are'} tagged with it`
  return `Every item and order line of "${from.name}" moves into "${into.name}", and ${tags}. "${from.name}" is then removed.`
}
