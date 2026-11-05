/*
 * Profitability reads the two monthly views the In vs out report already reads (v_month_profit: invoiced sales net of GST, costs and
 * profit; v_month_cash_flow: money received, GST included). Both are admin only by the database. One reader each, shared, so the two
 * pages never disagree about a month.
 */
import { fetchAll, requireSupabase } from '@/lib/supabase'
import { toPaisa } from '@/lib/money'

export { loadCashFlow, loadProfit } from '@/features/money/inOut/api'

/** What was spent on one enquiry that was closed without an order (v_enquiry_costs, state lost; 0136). Admin only by the database. */
export interface LostEnquiryCost {
  rfqId: string
  rfqNumber: number
  company: string
  /** Net of input tax, in paisa. */
  spent: bigint
  costCount: number
  lastPaidOn: string | null
}

export async function loadLostEnquiryCosts(): Promise<LostEnquiryCost[]> {
  const db = requireSupabase()
  const rows = await fetchAll((from, to) =>
    db
      .from('v_enquiry_costs')
      .select('rfq_id, rfq_number, company_name, spent_net, cost_count, last_paid_on')
      .eq('state', 'lost')
      .order('rfq_number', { ascending: false })
      .range(from, to),
  )
  return rows.flatMap(r =>
    r.rfq_id && r.rfq_number !== null
      ? [{ rfqId: r.rfq_id, rfqNumber: r.rfq_number, company: r.company_name ?? 'Unknown company', spent: toPaisa(r.spent_net ?? 0), costCount: r.cost_count ?? 0, lastPaidOn: r.last_paid_on }]
      : [],
  )
}
