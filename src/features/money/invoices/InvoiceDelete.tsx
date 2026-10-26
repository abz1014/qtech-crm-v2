import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { useToast } from '@/ui/useToast'
import { removeStoredFiles } from '@/features/rfqs/api'
import { monthKeyLabel, pkr } from '@/features/money/expenses/model'
import { GST_FILED_WARNING } from '@/features/money/invoices/model'
import type { InvoiceRow } from '@/features/money/invoices/api'
import { useDeleteInvoice } from '@/features/money/invoices/hooks'

/*
 * Delete an invoice (0092 delete_invoice; owner decisions 2026-10-23: permanent and admin only; a locked month must be reopened
 * first). One confirm (src/ui/ConfirmDelete). Two things it says before Delete:
 *   - ticked against a bank statement (tax_bank_month set, hint bank_ticked): the invoice cannot go until it is unticked in Match
 *     bank statement, so there is no Delete, only the sentence and the way there;
 *   - the month's GST return may already be filed (2026-10-26 owner decision): a warning and a tick, then Delete. Never a block.
 * The receipt files the database names are removed from storage afterwards; a file that will not go never undoes the delete.
 */
export function bankTickedSentence(taxBankMonth: string): string {
  return `This invoice has its tax deposit ticked against the ${monthKeyLabel(taxBankMonth.slice(0, 7))} bank statement. Untick it first, then delete it.`
}

export function useDeleteInvoiceFlow(invoice: InvoiceRow, opts: { gstMayBeFiled: boolean; onDeleted: () => void }) {
  const del = useDeleteInvoice()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  // The server refused with bank_ticked although this page did not know of it (ticked since it was opened).
  const [refusedMonth, setRefusedMonth] = useState<string | null>(null)
  const ticked = invoice.tax_bank_month ?? refusedMonth
  const gross = Number(invoice.net_amount) + Number(invoice.gst_amount)
  const name = invoice.number ? `invoice ${invoice.number}` : 'this invoice'

  const confirm = async () => {
    let files: Awaited<ReturnType<typeof del.mutateAsync>>
    try {
      files = await del.mutateAsync(invoice.id)
    } catch (e) {
      if (mapPgError(e).hint === 'bank_ticked') setRefusedMonth(invoice.tax_bank_month ?? invoice.invoice_date ?? '')
      throw e
    }
    // The rows are gone: nothing below may throw into the confirm.
    const failed = await removeStoredFiles(files)
    toast({ title: `Deleted ${name}`, body: `${pkr(gross)}${invoice.invoice_date ? ` · ${formatShortDate(invoice.invoice_date, undefined, true)}` : ''}`, tone: 'success' })
    if (failed.length > 0) toast({ title: 'Some files were not removed', body: `${failed.length} receipt ${failed.length === 1 ? 'file' : 'files'} stayed in storage. The invoice itself is deleted.` })
    opts.onDeleted()
  }

  const blocked: ReactNode = ticked ? (
    <>
      {bankTickedSentence(ticked || invoice.invoice_date || '')}{' '}
      <Link to={`/money/month-end/bank?month=${ticked.slice(0, 7)}`} className="font-medium text-primary underline">
        Open Bank check
      </Link>
    </>
  ) : null

  const node: ReactNode = open ? (
    <ConfirmDelete
      open
      onOpenChange={o => {
        if (!o) setOpen(false)
      }}
      thing={name}
      summary={
        <span data-testid="delete-invoice-what">
          {invoice.number ?? 'Invoice'} · {pkr(gross)}
          {invoice.invoice_date ? ` · ${formatShortDate(invoice.invoice_date, undefined, true)}` : ''}
        </span>
      }
      blocked={blocked}
      tick={opts.gstMayBeFiled ? { warning: GST_FILED_WARNING, label: 'I understand' } : undefined}
      onConfirm={confirm}
      errorMessage={e => mapPgError(e, { entity: 'invoice' }).message.replace(/An admin can reopen it\.?$/, 'Reopen the month first, in Lock a month.')}
    />
  ) : null

  return { ask: () => setOpen(true), node }
}
