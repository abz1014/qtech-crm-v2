import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { useToast } from '@/ui/useToast'
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
  // After a refusal this page does not know the statement month (it was ticked since the page loaded): say so rather than guess one.
  const which = taxBankMonth ? `the ${monthKeyLabel(taxBankMonth.slice(0, 7))} bank statement` : 'a bank statement'
  return `This invoice has its tax deposit ticked against ${which}. Untick it first, then delete it.`
}

export function useDeleteInvoiceFlow(invoice: InvoiceRow, opts: { gstMayBeFiled: boolean; onDeleted: () => void }) {
  const del = useDeleteInvoice()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  // The server refused with bank_ticked although this page did not know of it (ticked since it was opened).
  const [refused, setRefused] = useState(false)
  const ticked = invoice.tax_bank_month ?? ''
  const gross = Number(invoice.net_amount) + Number(invoice.gst_amount)
  const name = invoice.number ? `invoice ${invoice.number}` : 'this invoice'

  const confirm = async () => {
    try {
      await del.mutateAsync(invoice.id)
    } catch (e) {
      if (mapPgError(e).hint === 'bank_ticked') setRefused(true)
      throw e
    }
    // The rows are gone. The receipt files stay in storage for 30 days (migration 0120 lists them for the nightly purge).
    toast({ title: `Deleted ${name}`, body: `${pkr(gross)}${invoice.invoice_date ? ` · ${formatShortDate(invoice.invoice_date, undefined, true)}` : ''}`, tone: 'success' })
    opts.onDeleted()
  }

  const blocked: ReactNode = ticked || refused ? (
    <>
      {bankTickedSentence(ticked)}{' '}
      <Link to={ticked ? `/money/month-end/bank?month=${ticked.slice(0, 7)}` : '/money/month-end/bank'} className="font-medium text-primary underline">
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
