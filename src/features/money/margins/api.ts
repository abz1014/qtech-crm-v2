import { fetchAll, requireSupabase } from '@/lib/supabase'
import { lookupLabels } from '@/features/money/lookupLabels'
import type { MarginRow, MarginState } from '@/features/money/margins/model'

/*
 * Order margins (M04): every order's row from v_order_money (admin only: the view returns nothing to anyone else), with the
 * customer's name and the order date. Cancelled orders are left out: they have no sale. One read per table, joined here.
 */
export async function listOrderMargins(): Promise<MarginRow[]> {
  const db = requireSupabase()
  const [money, orders] = await Promise.all([
    fetchAll((from, to) => db.from('v_order_money').select('order_id, order_number, company_id, basis, net_sale, actual_cost, expected_cost, margin, margin_state, payment_state').range(from, to)),
    fetchAll((from, to) => db.from('orders').select('id, ordered_on, cancelled_on').range(from, to)),
  ])
  const live = new Map(orders.filter(o => !o.cancelled_on).map(o => [o.id, o.ordered_on]))
  const companyIds = [...new Set(money.map(m => m.company_id).filter((x): x is string => !!x))]
  // one lookup_labels call (ids in the body) instead of a read per 80 companies, one after another
  const names = new Map(Object.entries((await lookupLabels({ companies: companyIds })).companies))
  return money
    .filter(m => m.order_id && live.has(m.order_id))
    .map(m => {
      const state = (m.margin_state === 'final' || m.margin_state === 'basis_unknown' ? m.margin_state : 'provisional') as MarginState
      return {
        orderId: m.order_id as string,
        orderNumber: Number(m.order_number),
        companyName: (m.company_id && names.get(m.company_id)) || 'Unknown company',
        orderedOn: live.get(m.order_id as string) ?? null,
        basis: m.basis === 'invoice' || m.basis === 'items' ? m.basis : null,
        netSale: m.net_sale == null ? null : Number(m.net_sale),
        expectedCost: m.expected_cost == null ? null : Number(m.expected_cost),
        actualCost: Number(m.actual_cost ?? 0),
        margin: m.margin == null ? null : Number(m.margin),
        state,
        paymentState: m.payment_state ?? undefined,
      }
    })
}
