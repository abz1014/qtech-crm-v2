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
  /** The missing flag clears when a number OR a file exists (0119). */
  certificateMissing: boolean
  /** 0119: the certificate file, kept in the admin-only expense-receipts bucket. */
  certificatePath: string | null
  certificateName: string | null
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
    certificate_path: string | null
    certificate_name: string | null
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
    certificatePath: r.certificate_path,
    certificateName: r.certificate_name,
  }))
}

/** The bucket a WHT certificate file lives in: payments are admin only, and so is this one (0119). */
export const WHT_BUCKET = 'expense-receipts'

export interface WhtCertificateSave {
  paymentId: string
  /** The certificate number, or null to leave it as it is. */
  number: string | null
  /** A new file, or null to leave the file as it is. */
  file: File | null
  /** The path of the file being replaced, removed once the new one is saved. */
  oldPath: string | null
}

/**
 * Save the certificate number and/or file of one payment with WHT. The file goes to wht/{payment_id}/{uuid}.ext; a row that cannot
 * be written takes its new object back out. Attaching is allowed in a closed month (0119); the number is not (0116's month lock).
 */
export async function saveWhtCertificate(v: WhtCertificateSave): Promise<void> {
  const db = requireSupabase()
  const patch: { wht_certificate_no?: string; wht_certificate_path?: string; wht_certificate_name?: string } = {}
  if (v.number !== null) patch.wht_certificate_no = v.number
  let path: string | null = null
  if (v.file) {
    const ext = (/\.([a-z0-9]{1,5})$/i.exec(v.file.name)?.[1] ?? (v.file.type === 'application/pdf' ? 'pdf' : 'jpg')).toLowerCase()
    path = `wht/${v.paymentId}/${crypto.randomUUID()}.${ext}`
    const up = await db.storage.from(WHT_BUCKET).upload(path, v.file, { contentType: v.file.type || undefined, upsert: false })
    if (up.error) throw up.error
    patch.wht_certificate_path = path
    patch.wht_certificate_name = v.file.name.slice(0, 200)
  }
  if (Object.keys(patch).length === 0) return
  const res = await db.from('payments_in').update(patch).eq('id', v.paymentId).select('id')
  if (res.error || !res.data || res.data.length === 0) {
    if (path) await db.storage.from(WHT_BUCKET).remove([path])
    if (res.error) throw res.error
    throw new Error('Not saved. You may not have permission, or the payment is no longer there.')
  }
  if (path && v.oldPath) await db.storage.from(WHT_BUCKET).remove([v.oldPath])
}
