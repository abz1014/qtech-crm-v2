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
