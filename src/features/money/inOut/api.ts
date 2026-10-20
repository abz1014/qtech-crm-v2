import { fetchAll, requireSupabase } from '@/lib/supabase'
import { paisaToFixed, toPaisa } from '@/lib/money'
import type { DetailRow, FlowRow, ProfitRow } from '@/features/money/inOut/model'

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
    r.month ? [{ month: key(r.month), moneyIn: fx(r.money_in), payments: r.payments_count ?? 0, moneyOut: fx(r.money_out), expenses: r.expenses_count ?? 0, frozen: !!r.frozen }] : [],
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
