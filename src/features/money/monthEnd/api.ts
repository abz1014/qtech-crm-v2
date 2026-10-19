import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import { orderRef } from '@/lib/refs'
import { paisaToFixed, toPaisa, type Amount } from '@/lib/money'
import { companyNames } from '@/features/money/expenses/api'
import { legLabels } from '@/features/money/bank/api'
import { monthEnd, monthStart } from '@/features/money/expenses/model'
import type {
  AdvanceRow,
  AgingRow,
  CategoryLine,
  ClosedMonth,
  GstMonthRow,
  PayableRow,
  PaymentStats,
  RawPnl,
  CheckDetails,
  StatusRow,
  ViaStat,
} from '@/features/money/monthEnd/model'

/*
 * Month-end (M10): every database call for this area. The reports are the views and functions of migration 0028
 * (admin only, enforced twice: the explicit role check inside each and Row Level Security under it), so a non-admin
 * gets zero rows even if a request is made; the hooks pass `enabled` and no request is made at all.
 * Closing and reopening are the admin RPCs of migration 0027 (close_month, close_months_through, reopen_month).
 */
const fx = (n: Amount | null | undefined): string => paisaToFixed(toPaisa(n ?? 0))
const monthOf = (isoDate: string): string => isoDate.slice(0, 7)

// ------------------------------------------------------------------------------------------------ checklist and closing

export async function loadStatus(month: string): Promise<StatusRow[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.rpc('month_end_status', { p_month: monthStart(month) })) ?? []
  return rows.map(r => ({ check_key: r.check_key, n: Number(r.n) || 0 }))
}

/** The figures behind each check (migration 0064). Optional: a failure here leaves the cards on their fixed wording. */
export async function loadCheckDetails(month: string): Promise<CheckDetails> {
  const db = requireSupabase()
  const rows = unwrap(await db.rpc('month_end_check_details', { p_month: monthStart(month) })) ?? []
  return Object.fromEntries(rows.map(r => [r.check_key, (r.detail ?? {}) as Record<string, unknown>]))
}

export async function loadClosedMonths(): Promise<ClosedMonth[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('closed_months').select('month, closed_at, closed_by, note').order('month', { ascending: false })) ?? []
  const ids = [...new Set(rows.map(r => r.closed_by))]
  const people = ids.length ? (unwrap(await db.from('users').select('id, name').in('id', ids)) ?? []) : []
  const names = Object.fromEntries(people.map(p => [p.id, p.name]))
  return rows.map(r => ({ key: monthOf(r.month), closedAt: r.closed_at, closedBy: names[r.closed_by] ?? null, note: r.note }))
}

export async function closeMonth(month: string, through: boolean): Promise<void> {
  const db = requireSupabase()
  const res = through ? await db.rpc('close_months_through', { p_month: monthStart(month) }) : await db.rpc('close_month', { p_month: monthStart(month) })
  if (res.error) throw res.error
}

export async function reopenMonth(month: string, note: string): Promise<void> {
  const db = requireSupabase()
  const res = await db.rpc('reopen_month', { p_month: monthStart(month), p_note: note.trim() || undefined })
  if (res.error) throw res.error
}

// ------------------------------------------------------------------------------------------------ P&L and expenses

/** Every month that has any money in it, with its P&L. Small (a row a month), and the close rule needs the month list. */
export async function loadPnlMonths(): Promise<Record<string, RawPnl>> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('v_month_pnl').select('*').order('month', { ascending: false })) ?? []
  const out: Record<string, RawPnl> = {}
  for (const r of rows) {
    if (!r.month) continue
    out[monthOf(r.month)] = {
      netIn: fx(r.net_in),
      gstIn: fx(r.gst_in),
      unresolvedGross: fx(r.unresolved_gross),
      orderCosts: fx(r.order_costs),
      overheads: fx(r.overheads),
      result: fx(r.result),
      nonPnlOut: fx(r.non_pnl_out),
      afterDrawings: fx(r.after_drawings),
      cashOutTotal: fx(r.cash_out_total),
      inputTax: fx(r.input_tax),
    }
  }
  return out
}

/** The payments of one month by received date: how many, and the ones with no net split. */
export async function loadPaymentStats(month: string): Promise<PaymentStats> {
  const db = requireSupabase()
  const rows = await fetchAll<{ payment_id: string | null; order_id: string | null; amount: number | null; excluded_reason: string | null }>((from, to) =>
    db
      .from('v_payment_net')
      .select('payment_id, order_id, amount, excluded_reason')
      .gte('received_on', monthStart(month))
      .lte('received_on', monthEnd(month))
      .range(from, to),
  )
  const open = rows.filter(r => r.excluded_reason === 'basis_unknown' || r.excluded_reason === 'zero_value')
  const orderIds = [...new Set(open.map(r => r.order_id).filter((x): x is string => !!x))]
  const payIds = open.map(r => r.payment_id).filter((x): x is string => !!x)
  const orders = orderIds.length ? (unwrap(await db.from('orders').select('id, number').in('id', orderIds)) ?? []) : []
  const refs = payIds.length ? (unwrap(await db.from('payments_in').select('id, reference').in('id', payIds)) ?? []) : []
  const numberOf = Object.fromEntries(orders.map(o => [o.id, o.number]))
  const refOf = Object.fromEntries(refs.map(p => [p.id, p.reference]))
  return {
    count: rows.length,
    unresolved: open.map(r => ({
      orderRef: r.order_id && numberOf[r.order_id] !== undefined ? orderRef(numberOf[r.order_id]) : null,
      amount: fx(r.amount),
      reference: r.payment_id ? (refOf[r.payment_id] ?? null) : null,
    })),
  }
}

/** One month's categories (v_month_expense_category) with the default way each is paid. */
export async function loadCategoryLines(month: string): Promise<CategoryLine[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('v_month_expense_category').select('*').eq('month', monthStart(month))) ?? []
  const cats = unwrap(await db.from('expense_categories').select('id, default_paid_via')) ?? []
  const via = Object.fromEntries(cats.map(c => [c.id, c.default_paid_via]))
  return rows.map(r => ({
    categoryId: r.category_id as string,
    category: r.category as string,
    grp: r.grp as CategoryLine['grp'],
    sort: r.category_sort ?? 0,
    count: r.expense_count ?? 0,
    gross: fx(r.gross_paid),
    net: fx(r.net_cost),
    inputTax: paisaToFixed(toPaisa(r.gross_paid ?? 0) - toPaisa(r.net_cost ?? 0)),
    paidVia: via[r.category_id as string] === 'cash' ? 'cash' : 'bank',
  }))
}

/** How the month's expenses were paid, counted from the expenses themselves (a category's default is not what was done). */
export async function loadViaStat(month: string): Promise<ViaStat> {
  const db = requireSupabase()
  const rows = await fetchAll<{ paid_via: string; amount_pkr: number }>((from, to) =>
    db.from('expenses').select('paid_via, amount_pkr').gte('paid_on', monthStart(month)).lte('paid_on', monthEnd(month)).range(from, to),
  )
  const cash = rows.filter(r => r.paid_via === 'cash')
  const bank = rows.filter(r => r.paid_via !== 'cash')
  const add = (xs: { amount_pkr: number }[]) => paisaToFixed(xs.reduce((n, x) => n + toPaisa(x.amount_pkr), 0n))
  return { cashCount: cash.length, cashAmount: add(cash), bankCount: bank.length, bankAmount: add(bank) }
}

// ------------------------------------------------------------------------------------------------ aging and we owe

export async function loadAging(asOf: string): Promise<{ rows: AgingRow[]; advances: AdvanceRow[] }> {
  const db = requireSupabase()
  const data = unwrap(await db.rpc('aging_as_of', { p_date: asOf })) ?? []
  const names = await companyNames([...new Set(data.map(r => r.company_id).filter((x): x is string => !!x))])
  const rows: AgingRow[] = data
    .filter(r => r.kind === 'invoice')
    .map(r => ({
      invoiceId: r.invoice_id,
      customer: names[r.company_id] ?? 'Customer',
      invoiceNumber: r.invoice_number,
      orderRef: r.order_number ? orderRef(r.order_number) : null,
      invoiceDate: r.invoice_date,
      ageDays: Number(r.age_days) || 0,
      gross: fx(r.gross),
      applied: fx(r.applied),
      remaining: fx(r.remaining),
      bucket: r.bucket as AgingRow['bucket'],
    }))
  const advances: AdvanceRow[] = data
    .filter(r => r.kind === 'advance')
    .map(r => ({
      orderId: r.order_id,
      orderRef: r.order_number ? orderRef(r.order_number) : null,
      customer: names[r.company_id] ?? 'Customer',
      held: fx(r.advance_held),
    }))
  return { rows, advances }
}

export async function loadPayables(asOf: string): Promise<PayableRow[]> {
  const db = requireSupabase()
  const data = unwrap(await db.rpc('payables_as_of', { p_date: asOf })) ?? []
  const legs = await legLabels(data.map(r => r.supplier_order_id).filter((x): x is string => !!x))
  return data.map(r => ({
    legId: r.supplier_order_id,
    supplier: r.supplier_name ?? 'Supplier',
    orderRef: r.order_number ? orderRef(r.order_number) : null,
    leg: legs[r.supplier_order_id] ?? null,
    currency: r.currency ?? 'PKR',
    committed: r.committed === null || r.committed === undefined ? null : fx(r.committed),
    rate: r.fx_rate === null || r.fx_rate === undefined ? null : String(r.fx_rate),
    committedPkr: r.committed_pkr === null || r.committed_pkr === undefined ? null : fx(r.committed_pkr),
    paidPkr: fx(r.paid_pkr),
    owedPkr: r.owed_pkr === null || r.owed_pkr === undefined ? null : fx(r.owed_pkr),
    state: (r.state ?? 'owing') as PayableRow['state'],
    flag: r.flag ?? null,
  }))
}

// ------------------------------------------------------------------------------------------------ GST and team

export async function loadGstMonths(): Promise<GstMonthRow[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('v_gst_month').select('*').order('month', { ascending: false })) ?? []
  const out: GstMonthRow[] = []
  for (const r of rows) {
    if (!r.month) continue
    out.push({
      month: monthOf(r.month),
      invoiceCount: r.invoice_count ?? 0,
      net: fx(r.net),
      gst: fx(r.gst),
      psidSets: r.psid_set_count ?? 0,
      depositedCount: r.deposited_count ?? 0,
      depositedAmount: fx(r.deposited_amount),
      toDeposit: fx(r.gst_to_deposit),
      inputTax: r.input_tax === null || r.input_tax === undefined ? null : fx(r.input_tax),
    })
  }
  return out
}

export interface TeamData {
  credited: { userId: string; name: string; payments: number; net: string; quarterNet: string | null; quarterTarget: string | null }[]
  staff: { userId: string; name: string; role: string }[]
}

export async function loadTeamMonth(month: string): Promise<TeamData> {
  const db = requireSupabase()
  const credited = unwrap(await db.from('v_month_team').select('*').eq('month', monthStart(month))) ?? []
  const staff = unwrap(await db.from('users').select('id, name, role, deactivated_at')) ?? []
  return {
    credited: credited
      .filter(r => r.user_id)
      .map(r => ({
        userId: r.user_id as string,
        name: r.user_name ?? 'Someone',
        payments: r.payment_count ?? 0,
        net: fx(r.net_credited),
        quarterNet: r.quarter_achieved_net === null || r.quarter_achieved_net === undefined ? null : fx(r.quarter_achieved_net),
        quarterTarget: r.quarter_target_net === null || r.quarter_target_net === undefined ? null : fx(r.quarter_target_net),
      })),
    staff: staff.filter(s => !s.deactivated_at).map(s => ({ userId: s.id, name: s.name, role: s.role })),
  }
}
