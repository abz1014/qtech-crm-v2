import { fetchAll, requireSupabase } from '@/lib/supabase'
import { filingsOf, type GstFiling } from '@/features/money/accounts/gstModel'

/** The PSIDs and deposit dates stamped on the invoices, grouped by invoice month (admin and sales read invoices). */
export async function loadGstFilings(): Promise<GstFiling[]> {
  const db = requireSupabase()
  const rows = await fetchAll<{ invoice_date: string | null; psid: string | null; tax_deposited_on: string | null }>(
    (from, to) =>
      db
        .from('invoices')
        .select('invoice_date, psid, tax_deposited_on')
        .or('psid.not.is.null,tax_deposited_on.not.is.null')
        .order('invoice_date', { ascending: false })
        .range(from, to) as unknown as PromiseLike<{ data: { invoice_date: string | null; psid: string | null; tax_deposited_on: string | null }[] | null; error: { code?: string; message: string } | null }>,
  )
  return filingsOf(rows)
}

/** One payment with withholding tax deducted by the customer (0116, v_wht_deducted; admin only). */
export interface WhtRow {
  paymentId: string
  orderId: string
  orderNumber: number
  companyName: string | null
  receivedOn: string
  month: string
  amount: number
  certificateNo: string | null
  certificateMissing: boolean
}

/** Every payment with WHT deducted, newest first: the tax credit list on GST to FBR. */
export async function loadWhtDeducted(): Promise<WhtRow[]> {
  const db = requireSupabase()
  const rows = await fetchAll<{
    payment_id: string | null
    order_id: string | null
    order_number: number | null
    company_name: string | null
    received_on: string | null
    month: string | null
    wht_amount: number | null
    certificate_no: string | null
    certificate_missing: boolean | null
  }>(
    (from, to) =>
      db.from('v_wht_deducted').select('*').order('received_on', { ascending: false }).range(from, to) as unknown as PromiseLike<{
        data: never[] | null
        error: { code?: string; message: string } | null
      }>,
  )
  return rows.map(r => ({
    paymentId: r.payment_id as string,
    orderId: r.order_id as string,
    orderNumber: Number(r.order_number),
    companyName: r.company_name,
    receivedOn: r.received_on as string,
    month: r.month as string,
    amount: Number(r.wht_amount ?? 0),
    certificateNo: r.certificate_no,
    certificateMissing: !!r.certificate_missing,
  }))
}
