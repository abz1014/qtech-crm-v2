import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import type { FillBatch, ItemToFill } from '@/features/settings/productCategories/fillModel'

/*
 * Settings > Product categories (C4, C5): every server call for it. A product category is a brands row of kind family (0006);
 * `curated` (0093) marks the canonical ones the app suggests. Renaming and curating are admin only (the 0098 trigger says so in the
 * database); merging is merge_brands (0019, admin only), which moves every item, order line and supplier tag of the dropped one.
 */
export interface ProductCategory {
  id: string
  name: string
  curated: boolean
  /** Suppliers tagged with it (company_brands). */
  suppliers: number
}

export async function listProductCategories(): Promise<ProductCategory[]> {
  const db = requireSupabase()
  const [families, tags] = await Promise.all([
    fetchAll((from, to) => db.from('brands').select('id, name, curated').eq('kind', 'family').order('name').range(from, to)),
    fetchAll((from, to) => db.from('company_brands').select('brand_id, company_id').range(from, to)),
  ])
  const counts = new Map<string, number>()
  for (const t of tags) counts.set(t.brand_id, (counts.get(t.brand_id) ?? 0) + 1)
  return families.map(f => ({ id: f.id, name: f.name, curated: f.curated, suppliers: counts.get(f.id) ?? 0 }))
}

export async function renameProductCategory(id: string, name: string): Promise<void> {
  const { data, error } = await requireSupabase().from('brands').update({ name: name.trim() }).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw { code: '42501', message: 'Your role cannot make this change. Nothing was saved. Ask an admin if it needs doing.' }
}

export async function setProductCategoryCurated(id: string, curated: boolean): Promise<void> {
  const { data, error } = await requireSupabase().from('brands').update({ curated }).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw { code: '42501', message: 'Your role cannot make this change. Nothing was saved. Ask an admin if it needs doing.' }
}

/** Everything on `drop` moves onto `keep`, then `drop` is deleted (admin only; a family merges into a family). */
export async function mergeProductCategories(keep: string, drop: string): Promise<void> {
  unwrap(await requireSupabase().rpc('merge_brands', { p_keep: keep, p_drop: drop }))
}

/** Items with no category, for the dictionary to name one for. Paged, so none is lost past 1,000 rows. */
export async function listUncategorised(table: 'rfq_items' | 'order_items'): Promise<ItemToFill[]> {
  const db = requireSupabase()
  const rows = await fetchAll((from, to) => db.from(table).select('id, description').is('family_id', null).order('id').range(from, to))
  return rows.map(r => ({ id: r.id, description: r.description }))
}

/** One batch of the fill: only items still without a category change (a second run, or a hand edit meanwhile, is never overwritten). Returns how many changed. */
export async function applyFillBatch(batch: FillBatch): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.from(batch.table).update({ family_id: batch.familyId }).in('id', batch.ids).is('family_id', null).select('id')
  if (error) throw error
  return data?.length ?? 0
}
