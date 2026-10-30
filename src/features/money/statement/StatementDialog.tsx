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
import { qk } from '@/features/queryKeys'
import { useCompanyProfile } from '@/features/settings/hooks'
import { saveBlob } from '@/features/money/expenseReport/pdf/generate'
import { fetchStatementLines } from '@/features/money/statement/api'
import { generateStatementPdf } from '@/features/money/statement/generate'
import { KIND_LABEL, buildStatement, financialYearStart, fixed } from '@/features/money/statement/model'

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

const ROW = 'grid grid-cols-[6rem_minmax(0,1fr)_7rem_7rem_8rem] gap-x-3 px-3 py-2'

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
      toast.toast({ title: "Couldn't make the PDF", body: 'Nothing was changed. Try again.', tone: 'danger' })
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
              <span className="font-medium">From</span>
              <DateInput value={from} onChange={setFrom} aria-label="From" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">To</span>
              <DateInput value={to} onChange={setTo} aria-label="To" />
            </label>
          </div>
          {from && to && from > to ? (
            <Banner tone="warning" title="The first date is after the last date">
              Choose a From date that is on or before the To date.
            </Banner>
          ) : null}
          {lines.isError ? (
            <Banner tone="danger" title="Couldn't load the statement">
              Nothing was changed. Close this and try again.
            </Banner>
          ) : lines.isPending ? (
            <Skeleton className="h-[8rem] w-full" />
          ) : st ? (
            <div className="overflow-x-auto rounded border">
              <div className="min-w-[34rem] text-sm" role="list" aria-label="Statement lines">
                <div className={`${ROW} bg-sunken text-fg-muted`} role="presentation">
                  <span className="font-medium">Date</span>
                  <span className="font-medium">Document</span>
                  <span className="text-right font-medium">Charged</span>
                  <span className="text-right font-medium">Paid or credited</span>
                  <span className="text-right font-medium">Balance</span>
                </div>
                <div className={`${ROW} bg-sunken font-medium`} role="listitem" data-testid="statement-opening">
                  <span className="num">{formatShortDate(st.from, today)}</span>
                  <span>Opening balance</span>
                  <span />
                  <span />
                  <span className="num text-right">{fixed(st.opening)}</span>
                </div>
                {st.rows.map((r, i) => (
                  <div key={i} className={`${ROW} border-t`} role="listitem" data-testid="statement-row">
                    <span className="num">{formatShortDate(r.on, today)}</span>
                    <span>
                      {KIND_LABEL[r.kind]}
                      {r.ref ? <span className="num text-fg-2">{` ${r.ref}`}</span> : null}
                      {r.note ? <span className="text-fg-muted">{` · ${r.note}`}</span> : null}
                    </span>
                    <span className="num text-right">{r.debit > 0n ? fixed(r.debit) : ''}</span>
                    <span className="num text-right">{r.credit > 0n ? fixed(r.credit) : ''}</span>
                    <span className="num text-right">{fixed(r.balance)}</span>
                  </div>
                ))}
                {st.rows.length === 0 ? <p className="border-t px-3 py-3 text-fg-muted">Nothing happened on this account between these dates.</p> : null}
                <div className={`${ROW} border-t font-semibold`} role="listitem" data-testid="statement-closing">
                  <span className="num">{formatShortDate(st.to, today)}</span>
                  <span>Closing balance</span>
                  <span />
                  <span />
                  <span className="num text-right">{fixed(st.closing)}</span>
                </div>
              </div>
            </div>
          ) : null}
          <p className="text-sm text-fg-muted">A positive balance is what the customer owes us. Invoices paid before the new system started are not listed.</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
