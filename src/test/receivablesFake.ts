import { opArgs, type FakeCall } from '@/test/fakeSupabase'

/*
 * receivables_list() (0074) for the fake database: order_receivables()-shaped rows plus the company name and invoice numbers,
 * filtered by the call's arguments the way the function filters them, in order-number order, one 1,000-row page at a time.
 */
export interface ReceivableFixture {
  order_id: string
  order_number: number
  company_id: string
  gross_target: number
  payment_state: string
  [k: string]: unknown
}

export function receivablesListResult(
  call: FakeCall,
  rows: readonly ReceivableFixture[],
  extra: { companyName?: (companyId: string) => string | null; invoiceNumbers?: (orderId: string) => string[] } = {},
): { data: unknown[] } {
  const a = (opArgs(call, 'args')?.[0] ?? {}) as { p_state?: string; p_company_id?: string; p_order_id?: string; p_with_value?: boolean }
  const range = opArgs(call, 'range') as [number, number] | undefined
  const out = rows
    .filter(r => !a.p_order_id || r.order_id === a.p_order_id)
    .filter(r => !a.p_company_id || r.company_id === a.p_company_id)
    .filter(r => !a.p_with_value || Number(r.gross_target) > 0)
    .filter(r => !a.p_state || (a.p_state === 'open' ? r.payment_state !== 'settled' : r.payment_state === a.p_state))
    .sort((x, y) => x.order_number - y.order_number)
    .map(r => ({ company_name: extra.companyName?.(r.company_id) ?? null, invoice_numbers: extra.invoiceNumbers?.(r.order_id) ?? [], ...r }))
  return { data: range ? out.slice(range[0], range[1] + 1) : out }
}
