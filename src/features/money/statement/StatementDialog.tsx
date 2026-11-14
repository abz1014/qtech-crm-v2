import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown, ScrollText } from 'lucide-react'
import { useSession } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { DateInput } from '@/ui/form/DateInput'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { rupeesToPkr } from '@/lib/errors/rpcMessages'
import { qk } from '@/features/queryKeys'
import { useCompanyProfile } from '@/features/settings/hooks'
import { saveBlob } from '@/features/money/expenseReport/pdf/generate'
import { fetchStatementLines } from '@/features/money/statement/api'
import { generateStatementPdf } from '@/features/money/statement/generate'
import { KIND_LABEL, buildStatement, financialYearStart, grouped } from '@/features/money/statement/model'

/*
 * Statement of account (process audit 7). On the company page, admin only: choose the dates, see the opening balance, the invoices,
 * payments, credit notes and refunds with a running balance, and the closing balance, then download it as a PDF in the invoice's style.
 * A positive balance is what the customer owes. Nothing is read until the dialog opens.
 */
export function StatementButton({ companyId, companyName }: { companyId: string; companyName: string }) {
  const session = useSession()
  const [open, setOpen] = useState(false)
  if (session.status !== 'signed-in' || session.user.role !== 'admin') return null
  return (
    <>
      <Button icon={ScrollText} onClick={() => setOpen(true)}>
        Statement of account
      </Button>
      {open ? <StatementDialog companyId={companyId} companyName={companyName} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/*
 * Forest (55-credit-statement #st-ok): the lines sit in one framed box, opening and closing balance on the sunken band. The box is a size
 * container: from 34rem wide the lines are five columns under a header row; narrower (a phone, a narrow dialog) each line stacks, and
 * each figure carries its own label ("Charged, PKR: 118,000.00"), with an empty figure left out instead of a blank cell.
 */
// Class names are written out whole: Tailwind reads them from the source, so a variant built from a template string is never generated.
const ROW = 'grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 [@container(min-width:34rem)]:grid-cols-[minmax(0,5rem)_minmax(0,1fr)_minmax(0,7.5rem)_minmax(0,7.5rem)_minmax(0,8rem)] [@container(min-width:34rem)]:py-2'
const FIG = 'num [overflow-wrap:anywhere] [@container(min-width:34rem)]:text-right'
/** The figure's label: shown on a stacked line, kept for a screen reader on a wide one (the header row is presentation only). */
const LAB = 'font-sans text-fg-muted [@container(min-width:34rem)]:sr-only'
/** An empty figure: nothing on a stacked line, a blank cell on a wide one so the columns stay put. */
const NONE = 'hidden [@container(min-width:34rem)]:block'

function StatementDialog({ companyId, companyName, onClose }: { companyId: string; companyName: string; onClose: () => void }) {
  const today = businessToday()
  const toast = useToast()
  const profile = useCompanyProfile()
  const [from, setFrom] = useState(() => financialYearStart(today))
  const [to, setTo] = useState(today)
  const [making, setMaking] = useState(false)
  const lines = useQuery({ queryKey: [...qk.money.all, 'statement', companyId, to] as const, queryFn: () => fetchStatementLines(companyId, to) })
  const st = useMemo(() => (lines.data && from && to && from <= to ? buildStatement(lines.data, from, to) : null), [lines.data, from, to])

  const download = async () => {
    if (!st || !profile.data) return
    setMaking(true)
    try {
      const blob = await generateStatementPdf(st, companyName, profile.data, today)
      saveBlob(blob, `Statement ${companyName} ${from} to ${to}.pdf`.replace(/[\\/:*?"<>|]/g, ''))
    } catch {
      toast.toast({ title: "The PDF could not be made", body: 'Nothing was changed. Try again.', tone: 'danger' })
    } finally {
      setMaking(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title="Statement of account"
        context={companyName}
        icon={ScrollText}
        size="lg"
        footer={
          <>
            <Button data-cancel onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" icon={FileDown} busy={making} busyLabel="Making the PDF" disabled={!st || !profile.data} onClick={() => void download()}>
              Download PDF
            </Button>
          </>
        }
      >
        <div className="grid gap-4" data-testid="statement">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-semibold">From</span>
              <DateInput value={from} onChange={setFrom} aria-label="From" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-semibold">To</span>
              <DateInput value={to} onChange={setTo} aria-label="To" />
            </label>
          </div>
          {from && to && from > to ? (
            <Banner tone="warning" title="The first date is after the last date">
              Choose a From date that is on or before the To date.
            </Banner>
          ) : null}
          {lines.isError ? (
            <Banner tone="danger" title="The statement could not be loaded">
              Nothing was changed. Close this and try again.
            </Banner>
          ) : lines.isPending ? (
            <div role="status" aria-busy="true" aria-label="Loading the statement" className="grid gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-[5rem] w-full rounded-card" />
            </div>
          ) : st ? (
            <div className="min-w-0 [container-type:inline-size]">
              <div className="min-w-0 overflow-hidden rounded-card border text-sm" role="list" aria-label="Statement lines">
                <div className={`${ROW} hidden border-b text-fg-muted [@container(min-width:34rem)]:grid`} role="presentation">
                  <span className="font-semibold">Date</span>
                  <span className="font-semibold">Document</span>
                  <span className="text-right font-semibold">Charged</span>
                  <span className="text-right font-semibold">Paid or credited</span>
                  <span className="text-right font-semibold">Balance</span>
                </div>
                <div className={`${ROW} bg-sunken font-semibold`} role="listitem" data-testid="statement-opening">
                  <span className="num font-medium [overflow-wrap:anywhere]">{formatShortDate(st.from, today)}</span>
                  <span>Opening balance</span>
                  <span className={NONE} />
                  <span className={NONE} />
                  <span className={FIG}>
                    <span className={LAB}>Balance, PKR: </span>
                    {grouped(st.opening)}
                  </span>
                </div>
                {st.rows.map((r, i) => (
                  <div key={i} className={`${ROW} border-t`} role="listitem" data-testid="statement-row">
                    <span className="num [overflow-wrap:anywhere]">{formatShortDate(r.on, today)}</span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {KIND_LABEL[r.kind]}
                      {r.ref ? <span className="num font-medium">{` ${r.ref}`}</span> : null}
                      {r.note ? <span className="text-xs text-fg-muted">{` · ${rupeesToPkr(r.note)}`}</span> : null}
                    </span>
                    {r.debit > 0n ? (
                      <span className={FIG}>
                        <span className={LAB}>Charged, PKR: </span>
                        {grouped(r.debit)}
                      </span>
                    ) : (
                      <span className={NONE} />
                    )}
                    {r.credit > 0n ? (
                      <span className={FIG}>
                        <span className={LAB}>Paid or credited, PKR: </span>
                        {grouped(r.credit)}
                      </span>
                    ) : (
                      <span className={NONE} />
                    )}
                    <span className={FIG}>
                      <span className={LAB}>Balance, PKR: </span>
                      {grouped(r.balance)}
                    </span>
                  </div>
                ))}
                {st.rows.length === 0 ? <p className="border-t px-4 py-3 text-fg-muted">Nothing happened on this account between these dates.</p> : null}
                <div className={`${ROW} border-t bg-sunken font-semibold`} role="listitem" data-testid="statement-closing">
                  <span className="num font-medium [overflow-wrap:anywhere]">{formatShortDate(st.to, today)}</span>
                  <span>Closing balance</span>
                  <span className={NONE} />
                  <span className={NONE} />
                  <span className={FIG}>
                    <span className={LAB}>Balance, PKR: </span>
                    {grouped(st.closing)}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
          <p className="text-sm text-fg-muted">A positive balance is the amount the customer owes. Invoices paid before the new system started are not listed.</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
