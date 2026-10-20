import { requireSupabase, unwrap } from '@/lib/supabase'

/*
 * lookup_labels() (0074): company names, order numbers and supplier-order positions for id lists. The ids travel in the POST
 * body, so no list makes the URL too long (the old `.in('id', [...])` reads failed with HTTP 400 after a few hundred ids), and
 * the answer is one jsonb value, so nothing is cut at 1,000 rows. An id the caller cannot read, or that does not exist, is absent.
 */
export interface Labels {
  companies: Record<string, string>
  orders: Record<string, { number: number; company_id: string; company_name: string | null }>
  /** position: 0 for an order's first supplier order (by created_at, then id), 1 for the next... */
  legs: Record<string, { order_id: string; supplier_id: string; position: number }>
}

export async function lookupLabels(ids: { companies?: readonly string[]; orders?: readonly string[]; legs?: readonly string[] }): Promise<Labels> {
  const companies = [...new Set(ids.companies ?? [])]
  const orders = [...new Set(ids.orders ?? [])]
  const legs = [...new Set(ids.legs ?? [])]
  if (companies.length + orders.length + legs.length === 0) return { companies: {}, orders: {}, legs: {} }
  const db = requireSupabase()
  const data = unwrap(await db.rpc('lookup_labels', { p_company_ids: companies, p_order_ids: orders, p_leg_ids: legs })) as Partial<Labels> | null
  return { companies: data?.companies ?? {}, orders: data?.orders ?? {}, legs: data?.legs ?? {} }
}

/** "supplier order A", "supplier order B": a leg's place among its order's legs, as the Add expense dialog names them. */
export const legLabelOf = (position: number): string => `supplier order ${String.fromCharCode(65 + position)}`
