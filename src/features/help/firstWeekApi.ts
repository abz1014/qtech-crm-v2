import { requireSupabase } from '@/lib/supabase'
import type { FirstWeekFacts, FirstWeekItemId } from '@/features/help/firstWeek'

/*
 * The admin view of the first-week checklist (learnability spec 5.1): for the few people added in the last 14 days, when
 * each item was first done. Admin reads every table and the audit log (DATA_MODEL section 10). Rows are read oldest first,
 * so the first row per person is the date the item was first done. The id list is short, so each read is small.
 */
type Rows = { data: Record<string, unknown>[] | null; error: { code?: string; message: string } | null }
interface Q extends PromiseLike<Rows> {
  select(cols: string): Q
  in(col: string, values: string[]): Q
  eq(col: string, value: string): Q
  is(col: string, value: null): Q
  not(col: string, op: string, value: null): Q
  order(col: string, o: { ascending: boolean }): Q
}

interface Source {
  item: FirstWeekItemId
  /** The column naming the person. */
  who: string
  /** The column holding when. */
  when: string
  query: (from: (table: string) => Q) => Q
}

// An audit row where `col` went from empty to set: the moment it was stamped, by changed_by.
const stamped = (table: string, col: string) => (from: (t: string) => Q) =>
  from('audit_log').select('changed_by, changed_at').eq('table_name', table).not(`new_value->>${col}`, 'is', null).is(`old_value->>${col}`, null)

const SOURCES: Source[] = [
  { item: 'rfq', who: 'created_by', when: 'created_at', query: f => f('rfqs').select('created_by, created_at') },
  { item: 'ask', who: 'created_by', when: 'created_at', query: f => f('supplier_inquiries').select('created_by, created_at').not('sent_on', 'is', null) },
  { item: 'price', who: 'created_by', when: 'created_at', query: f => f('supplier_quote_lines').select('created_by, created_at') },
  { item: 'quotation', who: 'created_by', when: 'created_at', query: f => f('quotations').select('created_by, created_at') },
  { item: 'chase', who: 'last_chased_by', when: 'last_chased_on', query: f => f('supplier_inquiries').select('last_chased_by, last_chased_on') },
  { item: 'photo', who: 'created_by', when: 'created_at', query: f => f('attachments').select('created_by, created_at') },
  { item: 'delivered', who: 'changed_by', when: 'changed_at', query: stamped('supplier_orders', 'delivered_on') },
  { item: 'delivered', who: 'changed_by', when: 'changed_at', query: stamped('supplier_orders', 'received_on') },
  { item: 'commissioning', who: 'changed_by', when: 'changed_at', query: stamped('orders', 'commissioning_done_on') },
  { item: 'payment', who: 'created_by', when: 'created_at', query: f => f('payments_in').select('created_by, created_at') },
  { item: 'expenses', who: 'created_by', when: 'created_at', query: f => f('expenses').select('created_by, created_at') },
  { item: 'invoice', who: 'created_by', when: 'created_at', query: f => f('invoices').select('created_by, created_at') },
  { item: 'tcs-fbr', who: 'changed_by', when: 'changed_at', query: stamped('invoices', 'tcs_sent_on') },
  { item: 'tcs-fbr', who: 'changed_by', when: 'changed_at', query: stamped('invoices', 'psid') },
  { item: 'bank', who: 'changed_by', when: 'changed_at', query: stamped('payments_in', 'bank_month') },
  { item: 'bank', who: 'changed_by', when: 'changed_at', query: stamped('expenses', 'bank_month') },
]

/** Which sources a role's checklist needs, so a sales hire does not read the bank stamps. */
const NEEDS: Record<string, FirstWeekItemId[]> = {
  sales: ['rfq', 'ask', 'price', 'quotation', 'chase'],
  engineer: ['photo', 'delivered', 'commissioning'],
  admin: ['payment', 'expenses', 'invoice', 'tcs-fbr', 'bank'],
}

export async function fetchFirstWeek(people: { id: string; role: string }[]): Promise<FirstWeekFacts> {
  const facts: FirstWeekFacts = {}
  if (people.length === 0) return facts
  const db = requireSupabase()
  const from = (t: string) => (db.from as unknown as (n: string) => Q)(t)
  const wanted = new Set(people.flatMap(p => NEEDS[p.role] ?? []))
  const ids = people.map(p => p.id)
  await Promise.all(
    SOURCES.filter(s => wanted.has(s.item)).map(async s => {
      const { data, error } = await s.query(from).in(s.who, ids).order(s.when, { ascending: true })
      if (error) throw error
      for (const row of data ?? []) {
        const who = row[s.who]
        const when = row[s.when]
        if (typeof who !== 'string' || typeof when !== 'string') continue
        const mine = (facts[who] ??= {})
        const seen = mine[s.item]
        if (!seen || when < seen) mine[s.item] = when
      }
    }),
  )
  return facts
}
