import { fetchAll, requireSupabase } from '@/lib/supabase'
import { paisaToFixed, toPaisa } from '@/lib/money'
import type { DetailRow, FlowRow, InvoicedOrderCosts, ProfitRow } from '@/features/money/inOut/model'

/*
 * In vs out (0079): three admin-only views. The month rows are small (one a month), so the cash and profit rows are read whole;
 * the detail rows only for the months shown and the period before.
 */
const fx = (n: number | string | null | undefined): string => paisaToFixed(toPaisa(n ?? 0))
const key = (month: string | null): string => (month ?? '').slice(0, 7)

export async function loadCashFlow(): Promise<FlowRow[]> {
  const db = requireSupabase()
  const rows = await fetchAll((from, to) => db.from('v_month_cash_flow').select('*').order('month').range(from, to))
  return rows.flatMap(r =>
    r.month ? [{ month: key(r.month), moneyIn: fx(r.money_in), payments: r.payments_count ?? 0, moneyOut: fx(r.money_out), expenses: r.expenses_count ?? 0, frozen: !!r.frozen, refunds: fx(r.refunds_out), refundCount: r.refunds_count ?? 0 }] : [],
  )
}

export async function loadProfit(): Promise<ProfitRow[]> {
  const db = requireSupabase()
  const rows = await fetchAll((from, to) => db.from('v_month_profit').select('*').order('month').range(from, to))
  return rows.flatMap(r =>
    r.month
      ? [
          {
            month: key(r.month),
            salesNet: fx(r.sales_net),
            salesGst: fx(r.sales_gst),
            invoices: r.invoice_count ?? 0,
            orderCostsMatched: fx(r.order_costs_matched),
            overheads: fx(r.overheads),
            profit: fx(r.profit),
            orderCostsPaid: fx(r.order_costs_paid),
            nonPnlPaid: fx(r.non_pnl_paid),
            inputTaxPaid: fx(r.input_tax_paid),
          },
        ]
      : [],
  )
}

/**
 * Each invoiced order's first live invoice month and whether its costs are in (screen 06): the invoices (void ones left out, as
 * v_month_profit) and v_order_money's margin_state and actual_cost. Admin only, as the rest of the report.
 */
export async function loadInvoicedOrderCosts(): Promise<InvoicedOrderCosts[]> {
  const db = requireSupabase()
  const [invoices, money] = await Promise.all([
    fetchAll((from, to) => db.from('invoices').select('id, order_id, invoice_date').is('voided_at', null).not('order_id', 'is', null).not('invoice_date', 'is', null).order('id').range(from, to)),
    fetchAll((from, to) => db.from('v_order_money').select('order_id, margin_state, actual_cost').range(from, to)),
  ])
  const first = new Map<string, string>()
  for (const v of invoices) {
    if (!v.order_id || !v.invoice_date) continue
    const m = key(v.invoice_date)
    const had = first.get(v.order_id)
    if (had === undefined || m < had) first.set(v.order_id, m)
  }
  return money.flatMap(r => {
    const month = r.order_id ? first.get(r.order_id) : undefined
    return r.order_id && month ? [{ orderId: r.order_id, firstInvoiceMonth: month, final: r.margin_state === 'final', costEntered: toPaisa(r.actual_cost ?? 0) > 0n }] : []
  })
}

/** Money out by month, category and detail, from one month key to another ("2026-07" to "2026-12"). */
export async function loadCashOutDetail(fromMonth: string, toMonth: string): Promise<DetailRow[]> {
  const db = requireSupabase()
  const rows = await fetchAll((from, to) =>
    db
      .from('v_month_cash_out_detail')
      .select('month, category_id, detail, gross_paid, expense_count')
      .gte('month', `${fromMonth}-01`)
      .lte('month', `${toMonth}-01`)
      .range(from, to),
  )
  return rows.flatMap(r =>
    r.month && r.category_id ? [{ month: key(r.month), categoryId: r.category_id, detail: r.detail, gross: fx(r.gross_paid), count: r.expense_count ?? 0 }] : [],
  )
}
