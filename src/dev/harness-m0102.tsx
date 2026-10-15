import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'

// Local review harness only (not committed): the mockups' own figures behind the fake client.
const today = new Date().toISOString().slice(0, 10)
const addDays = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const inv = (id: string, no: string, date: string, co: string, ord: number, net: number, tcs: string, fbr: string, extra: Record<string, unknown> = {}) => ({
  invoice_id: id, invoice_date: date, invoice_month: date.slice(0, 7) + '-01', number: no, order_id: `o${ord}`, order_number: ord, company_id: `c-${co}`, company_name: co,
  net_amount: net, gst_amount: Math.round(net * 0.18), gross_amount: net + Math.round(net * 0.18), courier_state: tcs, fbr_state: fbr, fbr_exception: false,
  needs_fbr_attention: false, psid: fbr === 'pending' ? null : 'PSID', tax_deposited_on: fbr === 'deposited' ? date : null, tax_deposit_amount: null, ...extra,
})
const m = (n: number) => addDays(-n)
const register = [
  inv('i1', 'INV-2311', m(2), 'Hazara Paper Board', 41, 860000, 'not_started', 'pending'),
  inv('i2', 'INV-2308', m(6), 'Margalla Steel Re-rolling', 37, 312500, 'sent', 'generated'),
  inv('i3', 'INV-2302', m(21), 'Sindh Pharma Works', 33, 745000, 'delivered_to_client', 'receipt_received'),
  inv('i4', 'INV-2299', m(40), 'Lahore Beverage Co.', 35, 468000, 'delivered_to_client', 'deposited'),
  inv('i5', 'INV-2291', m(52), 'Karachi Glassworks', 34, 1054500, 'delivered_to_client', 'receipt_received', { needs_fbr_attention: true }),
  inv('i6', 'INV-2284', m(60), 'Margalla Steel Re-rolling', 36, 2180000, 'delivered_to_client', 'deposited'),
  inv('i7', 'INV-2271', m(80), 'Lahore Beverage Co.', 34, 395000, 'delivered_to_client', 'deposited'),
  inv('i8', 'INV-2256', m(100), 'Indus Textile Mills', 30, 1620000, 'sent', 'generated', { needs_fbr_attention: true }),
  inv('i9', 'INV-2249', m(110), 'Hazara Paper Board', 12, 540000, 'copy_received', 'deposited', { fbr_exception: true, psid: null }),
]
const rc = (ord: number, co: string, gross: number, settled: number, due: number | null, state: string, rem: [string | null, number] = [null, 0]) => ({
  order_id: `o${ord}`, order_number: ord, company_id: `c-${co}`, owner_id: 'u', gross_target: gross, settled, balance: Math.max(gross - settled, 0), overpaid_by: 0,
  due_on: due === null ? null : addDays(due), is_overdue: state === 'overdue', payment_state: state, last_reminded_on: rem[0], reminder_count: rem[1], data_trust: 'ok',
})
const receivables = [
  rc(27, 'Indus Textile Mills', 1911600, 800000, -38, 'overdue', [addDays(-13), 2]),
  rc(31, 'Karachi Glassworks', 1244310, 0, -12, 'overdue', [addDays(-8), 1]),
  rc(33, 'Sindh Pharma Works', 879100, 250000, 9, 'part'),
  rc(35, 'Lahore Beverage Co.', 552240, 300000, 17, 'part'),
  rc(41, 'Hazara Paper Board', 1014800, 0, 28, 'unpaid'),
  rc(38, 'Punjab Cement Ltd', 2300764, 700000, null, 'part'),
  rc(20, 'Old Customer', 100000, 100000, -90, 'settled'),
]
const invNums: Record<string, string> = { o27: 'INV-2256', o31: 'INV-2291', o33: 'INV-2302', o35: 'INV-2299', o41: 'INV-2311', o20: 'INV-2100' }
const names = [...new Set([...register.map(r => r.company_name), ...receivables.map(r => String(r.company_id).slice(2))])]

;(window as unknown as { __closedMonth: boolean }).__closedMonth = false
installFakeDb((c: FakeCall) => {
  if (c.target === 'v_gst_register') return { data: register }
  if (c.target === 'rpc:order_receivables') {
    const arg = (c.ops[0]?.[1][0] as { p_order_id?: string } | undefined)?.p_order_id
    return { data: arg ? receivables.filter(r => r.order_id === arg) : receivables }
  }
  if (c.target === 'rpc:next_invoice_number') return { data: [{ next_number: 'INV-2312', last_number: 'INV-2311', last_date: m(2) }] }
  if (c.target.startsWith('rpc:stamp_')) return { data: 1 }
  if (c.target === 'companies') return { data: names.map(n => ({ id: `c-${n}`, name: n })) }
  if (c.target === 'orders') {
    return { data: receivables.map(r => ({ id: r.order_id, number: r.order_number, company_id: r.company_id, cancelled_on: null, payment_terms_days: 30 })) }
  }
  if (c.target === 'invoices') {
    if (c.ops.some(([k]) => k === 'maybeSingle')) return { data: { id: 'i5', number: 'INV-2291', invoice_date: m(52), net_amount: 1054500, gst_amount: 189810, tcs_sent_on: null, psid: null, notes: null } }
    if (c.ops.some(([k, a]) => k === 'select' && String(a[0]).includes('number'))) return { data: Object.entries(invNums).map(([o, n]) => ({ order_id: o, number: n, invoice_date: m(50) })) }
    return { data: [] }
  }
  if (c.target === 'v_order_items_total') return { data: { net: 1949800, gst: 350964 } }
  if (c.target === 'order_items') return { data: Array.from({ length: 8 }, () => ({ gst_rate: 18 })) }
  if (c.target === 'payments_in') {
    if (c.verb === 'insert') return (window as unknown as { __closedMonth: boolean }).__closedMonth ? { error: { code: 'P0001', message: 'September 2026 is closed. An admin can reopen it.' } } : {}
    return { data: [{ received_on: addDays(-30), amount: 700000 }] }
  }
  return { data: [] }
})
