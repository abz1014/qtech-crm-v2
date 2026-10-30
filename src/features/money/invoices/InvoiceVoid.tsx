import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Ban, FilePlus2 } from 'lucide-react'
import { formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { TextArea, TextField } from '@/ui/form/TextField'
import { useToast } from '@/ui/useToast'
import { removeStoredFiles } from '@/features/rfqs/api'
import { monthKeyLabel, pkr } from '@/features/money/expenses/model'
import { GST_FILED_WARNING } from '@/features/money/invoices/model'
import type { InvoiceRow } from '@/features/money/invoices/api'
import { useDeleteInvoice } from '@/features/money/invoices/hooks'
import { creditGst, useCreateCreditNote, useCreditNotes, useVoidInvoice } from '@/features/money/invoices/creditNotes'

/*
 * Void or credit an invoice that has a number; delete one that has none (0112: before it, any invoice could be deleted).
 *   Void (useVoidInvoiceFlow)         the invoice keeps its number and row, counts for nothing, and says why, who and when. Only while
 *                                     its month is open, nothing is filed (no PSID, tax deposit or bank tick) and no payment is
 *                                     applied to it; otherwise the dialog says so and offers the Credit note instead.
 *   Credit note (useCreditNoteFlow)   CN-0001, CN-0002 ...: a full or part credit with its own GST, issued today, against one invoice.
 *   Delete (useDeleteInvoiceFlow)     only an invoice with no number (an imported row), as before.
 *
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
    let files: Awaited<ReturnType<typeof del.mutateAsync>>
    try {
      files = await del.mutateAsync(invoice.id)
    } catch (e) {
      if (mapPgError(e).hint === 'bank_ticked') setRefused(true)
      throw e
    }
    // The rows are gone: nothing below may throw into the confirm.
    const failed = await removeStoredFiles(files)
    toast({ title: `Deleted ${name}`, body: `${pkr(gross)}${invoice.invoice_date ? ` · ${formatShortDate(invoice.invoice_date, undefined, true)}` : ''}`, tone: 'success' })
    if (failed.length > 0) toast({ title: 'Some files were not removed', body: `${failed.length} receipt ${failed.length === 1 ? 'file' : 'files'} stayed in storage. The invoice itself is deleted.` })
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

// ------------------------------------------------------------------ void (0112)

/** The hints void_invoice sends when the invoice is past voiding: the way on is a credit note. */
const CREDIT_NOTE_INSTEAD = new Set(['filed', 'month_closed', 'paid'])

export function useVoidInvoiceFlow(invoice: InvoiceRow, opts: { monthClosed: boolean; onDone: () => void; onCreditNote: () => void }) {
  const voidIt = useVoidInvoice()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<{ message: string; creditNote: boolean } | null>(null)
  const name = invoice.number ? `invoice ${invoice.number}` : 'this invoice'
  const filed = !!invoice.psid?.trim() || !!invoice.tax_deposited_on || !!invoice.tax_bank_month
  const upfront = filed
    ? `Invoice ${invoice.number ?? ''} has a PSID or a tax deposit recorded, so it cannot be voided.`
    : opts.monthClosed
      ? `The month of invoice ${invoice.number ?? ''} is closed, so it cannot be voided.`
      : null

  const close = () => {
    if (voidIt.isPending) return
    setOpen(false)
    setError(null)
    setReason('')
  }
  const confirm = async () => {
    setError(null)
    try {
      await voidIt.mutateAsync({ invoiceId: invoice.id, reason })
    } catch (e) {
      const m = mapPgError(e, { entity: 'invoice' })
      setError({ message: m.message, creditNote: CREDIT_NOTE_INSTEAD.has(m.hint ?? '') })
      return
    }
    toast({ title: `Voided ${name}`, body: 'The number stays in the register. It no longer counts in receivables or GST.', tone: 'success' })
    setOpen(false)
    opts.onDone()
  }
  const toCreditNote = () => {
    close()
    opts.onCreditNote()
  }
  const showCredit = !!upfront || !!error?.creditNote

  const node: ReactNode = open ? (
    <Dialog open onOpenChange={o => !o && close()} busy={voidIt.isPending}>
      <DialogContent
        title={`Void ${name}?`}
        icon={Ban}
        tone="danger"
        size="sm"
        footer={
          <>
            <Button size="lg" data-cancel onClick={close} disabled={voidIt.isPending}>
              Cancel
            </Button>
            {showCredit ? (
              <Button size="lg" variant="primary" icon={FilePlus2} onClick={toCreditNote}>
                Create credit note
              </Button>
            ) : null}
            {upfront ? null : (
              <Button size="lg" variant="danger" onClick={() => void confirm()} busy={voidIt.isPending} busyLabel="Voiding" disabled={reason.trim() === ''}>
                Void invoice
              </Button>
            )}
          </>
        }
      >
        <div className="grid gap-3 text-base" data-testid="void-invoice">
          {upfront ? (
            <p role="alert" className="font-medium text-tone-danger-fg" data-testid="void-blocked">
              {upfront} Issue a credit note instead: it corrects the invoice without changing its number.
            </p>
          ) : (
            <>
              <p>
                The invoice keeps its number in the register but counts for nothing: it leaves what customers owe, the aging report, sales and the month&rsquo;s GST. This can&rsquo;t be undone.
              </p>
              <label className="grid gap-1">
                <span className="font-medium">Why is it being voided?</span>
                <TextArea value={reason} onChange={e => setReason(e.target.value)} maxLength={300} rows={2} aria-label="Reason for voiding" />
              </label>
            </>
          )}
          {error ? (
            <p role="alert" className="text-tone-danger-fg" data-testid="void-error">
              {error.message}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  ) : null

  return { ask: () => setOpen(true), node }
}

// ------------------------------------------------------------------ credit note (0112)

const toNumber = (s: string): number => {
  const n = Number(s.replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : NaN
}

export function useCreditNoteFlow(invoice: InvoiceRow, opts: { onDone?: () => void } = {}) {
  const create = useCreateCreditNote()
  const notes = useCreditNotes(invoice.id)
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [net, setNet] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const invNet = Number(invoice.net_amount)
  const invGst = Number(invoice.gst_amount)
  const credited = (notes.data ?? []).reduce((s, n) => ({ net: s.net + n.net, gst: s.gst + n.gst }), { net: 0, gst: 0 })
  const leftNet = Math.round((invNet - credited.net) * 100) / 100
  const amount = toNumber(net)
  const valid = Number.isFinite(amount) && amount > 0 && amount <= leftNet
  const gst = valid ? creditGst({ net: invNet, gst: invGst }, credited, amount) : 0

  const close = () => {
    if (create.isPending) return
    setOpen(false)
    setError(null)
  }
  const ask = () => {
    setNet(String(Math.max(leftNet, 0)))
    setReason('')
    setError(null)
    setOpen(true)
  }
  const submit = async () => {
    setError(null)
    try {
      const made = await create.mutateAsync({ invoiceId: invoice.id, net: amount, gst, reason })
      toast({ title: `Credit note ${made.number} issued`, body: `${pkr(amount + gst)} against ${invoice.number ?? 'the invoice'}`, tone: 'success' })
      setOpen(false)
      opts.onDone?.()
    } catch (e) {
      setError(mapPgError(e, { entity: 'credit note' }).message)
    }
  }

  const node: ReactNode = open ? (
    <Dialog open onOpenChange={o => !o && close()} busy={create.isPending}>
      <DialogContent
        title={`Credit note against ${invoice.number ?? 'this invoice'}`}
        icon={FilePlus2}
        size="sm"
        footer={
          <>
            <Button size="lg" data-cancel onClick={close} disabled={create.isPending}>
              Cancel
            </Button>
            <Button size="lg" variant="primary" onClick={() => void submit()} busy={create.isPending} busyLabel="Issuing" disabled={!valid || reason.trim() === '' || notes.isPending}>
              Issue credit note
            </Button>
          </>
        }
      >
        <div className="grid gap-3 text-base" data-testid="credit-note-dialog">
          <p>A credit note reduces what the customer owes and the GST of the month it is issued in (today). The invoice and its number stay as they are.</p>
          <p className="num text-fg-2" data-testid="credit-note-left">
            Invoice {pkr(invNet)} + GST {pkr(invGst)}. Left to credit: {pkr(Math.max(leftNet, 0))}.
          </p>
          <label className="grid gap-1">
            <span className="font-medium">Amount to credit, without GST (PKR)</span>
            <TextField value={net} onChange={e => setNet(e.target.value)} inputMode="decimal" className="num" aria-label="Amount to credit" />
          </label>
          <p className="num text-fg-2" data-testid="credit-note-gst">
            {valid ? `GST on it: ${pkr(gst)}. The customer is credited ${pkr(amount + gst)}.` : `Enter an amount up to ${pkr(Math.max(leftNet, 0))}.`}
          </p>
          <label className="grid gap-1">
            <span className="font-medium">Why is it being credited?</span>
            <TextArea value={reason} onChange={e => setReason(e.target.value)} maxLength={300} rows={2} aria-label="Reason for the credit note" />
          </label>
          {error ? (
            <p role="alert" className="text-tone-danger-fg" data-testid="credit-note-error">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  ) : null

  return { ask, node }
}
