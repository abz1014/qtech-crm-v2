import { requireSupabase } from '@/lib/supabase'

/*
 * Palette search (R12, P02): one round trip to the database function search_all (migrations 0034 and 0054), which does companies,
 * contacts, RFQ numbers and customer refs, orders, order items, supplier PO numbers and (admin and sales only) invoice numbers
 * under the caller's row security. The caller hands in the palette's
 * AbortSignal so a request that a newer keystroke has replaced is cancelled in the browser.
 */
export type SearchKind = 'company' | 'contact' | 'rfq' | 'order' | 'item' | 'po' | 'invoice'
export type SearchRole = 'customer' | 'supplier' | 'both' | 'prospect'

export interface SearchHit {
  kind: SearchKind
  id: string
  label: string
  meta: string | null
  /** The company to open (a contact opens its company). */
  companyId: string | null
  /** The order to open: orders, order items and supplier POs. Invoices carry it too (the order they bill). */
  orderId: string | null
  /** Companies only. */
  role: SearchRole | null
  score: number
}

const KINDS: readonly string[] = ['company', 'contact', 'rfq', 'order', 'item', 'po', 'invoice']
const ROLES: readonly string[] = ['customer', 'supplier', 'both', 'prospect']

export async function searchAll(text: string, signal?: AbortSignal, limit = 6): Promise<SearchHit[]> {
  const q = text.trim().replace(/\s+/g, ' ')
  if (!q) return []
  const db = requireSupabase()
  let req = db.rpc('search_all', { q, lim: limit })
  if (signal) req = req.abortSignal(signal)
  const { data, error } = await req
  if (error) throw new Error(error.message)
  return (data ?? [])
    .filter(r => KINDS.includes(r.kind))
    .map(r => ({
      kind: r.kind as SearchKind,
      id: r.id,
      label: r.label,
      meta: r.meta || null,
      companyId: r.company_id || null,
      orderId: r.order_id || null,
      role: r.role && ROLES.includes(r.role) ? (r.role as SearchRole) : null,
      score: r.score,
    }))
}
