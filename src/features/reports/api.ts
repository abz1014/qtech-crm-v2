import { fetchAll, requireSupabase } from '@/lib/supabase'
import type { ViewRow } from '@/features/dbTypes'
import type { FloatRow, OutcomeRow, RepeatRow, TurnaroundRow } from '@/features/reports/model'

/*
 * Reports (P01): four reads, one per view. Admin and sales only: the views return no rows for anyone else, and the
 * screen does not make these requests for an engineer (the Reports route is closed to them). No money is read.
 */
const n = (v: number | null | undefined): number => Number(v ?? 0)

export async function listOutcomes(): Promise<OutcomeRow[]> {
  const db = requireSupabase()
  const rows = await fetchAll<ViewRow<'v_report_rfq_outcomes'>>((from, to) =>
    db.from('v_report_rfq_outcomes').select('*').range(from, to),
  )
  return rows.map(r => ({ outcome: r.outcome as OutcomeRow['outcome'], closeReason: r.close_reason, rfqs: n(r.rfqs) }))
}

export async function listFloat(): Promise<FloatRow[]> {
  const db = requireSupabase()
  const rows = await fetchAll<ViewRow<'v_report_float'>>((from, to) => db.from('v_report_float').select('*').range(from, to))
  return rows.map(r => ({
    state: r.sourcing_state ?? '',
    rfqs: n(r.rfqs),
    itemsTotal: n(r.items_total),
    itemsQuoted: n(r.items_quoted),
    won: n(r.won),
    closed: n(r.closed),
    open: n(r.still_open),
  }))
}

export async function listTurnaround(): Promise<TurnaroundRow[]> {
  const db = requireSupabase()
  const rows = await fetchAll<ViewRow<'v_report_clarification_turnaround'>>((from, to) =>
    db.from('v_report_clarification_turnaround').select('*').range(from, to),
  )
  return rows.map(r => ({
    month: r.month ?? '',
    asked: n(r.asked),
    answered: n(r.answered),
    withdrawn: n(r.withdrawn),
    open: n(r.still_open),
    avgDays: r.avg_days === null ? null : Number(r.avg_days),
    slowestDays: r.slowest_days === null ? null : Number(r.slowest_days),
    totalDays: n(r.total_days),
  }))
}

export async function listRepeatCustomers(): Promise<RepeatRow[]> {
  const db = requireSupabase()
  const rows = await fetchAll<ViewRow<'v_report_repeat_customers'>>((from, to) =>
    db.from('v_report_repeat_customers').select('*').order('company_id').range(from, to),
  )
  return rows.map(r => ({
    companyId: r.company_id ?? '',
    name: r.name ?? '',
    orders: n(r.orders),
    firstOrderOn: r.first_order_on,
    lastOrderOn: r.last_order_on,
    rfqs: n(r.rfqs),
    isRepeat: Boolean(r.is_repeat),
  }))
}
