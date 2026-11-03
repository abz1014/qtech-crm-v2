import { FileCheck2, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useSeesPrices } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { MoreMenu } from '@/ui/MoreMenu'
import { MenuItem, MenuSeparator } from '@/ui/Popover'
import { useToast } from '@/ui/useToast'
import type { JobSlotProps } from '@/features/jobs/slots'
import { useOrdersForRfq } from '@/features/orders/forRfq'
import { useWonDialog } from '@/features/orders/useWonDialog'
import { useQuotations } from '@/features/quotations/hooks'
import type { RfqHeader } from '@/features/rfqs/api'
import { useDeleteRfqFlow } from '@/features/rfqs/deleteFlow'
import { useRfqHeader, useSetBidSent, useSetRfqClosed } from '@/features/rfqs/hooks'
import { CLOSE_REASONS, closeReasonLabel, defaultCloseReason, type CloseReason } from '@/features/rfqs/lib/closeDefaults'
import { quotationSent } from '@/features/rfqs/lib/nextAction'
import { useEditRfqFlow } from '@/features/rfqs/useEditRfqFlow'

/** The RFQ More menu on the job page (see RfqMore, which decides when it is downloaded). */
export default function RfqMoreInner({ job }: JobSlotProps) {
  const header = useRfqHeader(job.job.rfqId ?? undefined)
  if (!header.data) return null
  return <Menu rfq={header.data} money={job.money} />
}

function Menu({ rfq, money }: { rfq: RfqHeader; money: boolean }) {
  const { toast } = useToast()
  const bid = useSetBidSent(rfq.id)
  const closeRfq = useSetRfqClosed(rfq.id)
  const edit = useEditRfqFlow(rfq)
  const del = useDeleteRfqFlow(rfq)
  const [, setWon] = useWonDialog()
  const prices = useSeesPrices() && money
  const orders = useOrdersForRfq(rfq.id)
  const quotations = useQuotations(prices ? rfq.id : undefined)
  const ref = rfqRef(rfq.number)
  const s = rfq.state
  const sent = quotationSent({ bidState: s?.bid_state, quotationCount: quotations.data?.length ?? 0 })
  const closed = rfq.closedOn !== null
  const hasLiveOrder = (orders.data ?? []).some(o => !o.cancelledOn)
  const suggested = s
    ? defaultCloseReason({ sourcingState: s.sourcing_state, clarificationState: s.clarification_state, bidState: s.bid_state, isOverdue: Boolean(s.is_overdue) })
    : 'other'
  const fail = (title: string) => (err: unknown) => toast({ title, body: mapPgError(err, { entity: 'RFQ' }).message, tone: 'danger' })

  const markSent = async (again: boolean) => {
    const before = rfq.quotedOn
    try {
      await bid.mutateAsync(businessToday())
      toast({
        title: again ? 'Quotation date updated' : 'Marked quotation sent',
        body: `${ref} · ${rfq.company.name}`,
        undo: {
          onUndo: async () => {
            await bid.mutateAsync(before)
          },
          settledTitle: again ? 'Quotation date updated' : 'Marked quotation sent',
          undoneTitle: again ? 'Date put back' : 'Quotation sent taken back',
        },
      })
    } catch (err) {
      fail('Could not mark the quotation sent')(err)
    }
  }
  const close = async (reason: CloseReason) => {
    try {
      await closeRfq.mutateAsync({ closedOn: businessToday(), reason, note: null })
      toast({
        title: 'Closed',
        body: `${ref} · ${closeReasonLabel(reason)}`,
        undo: {
          onUndo: async () => {
            await closeRfq.mutateAsync({ closedOn: null, reason: null, note: null })
          },
          settledTitle: 'Closed',
          undoneTitle: 'Reopened',
        },
      })
    } catch (err) {
      fail('Could not close the RFQ')(err)
    }
  }
  const reopen = async () => {
    const before = { closedOn: rfq.closedOn, reason: rfq.closeReason, note: rfq.closeNote }
    try {
      await closeRfq.mutateAsync({ closedOn: null, reason: null, note: null })
      toast({
        title: 'Reopened',
        body: `${ref} is open again`,
        undo: {
          onUndo: async () => {
            await closeRfq.mutateAsync(before)
          },
          settledTitle: 'Reopened',
          undoneTitle: 'Closed again',
        },
      })
    } catch (err) {
      fail('Could not reopen')(err)
    }
  }

  return (
    <>
      <MoreMenu label="More actions" menuClassName="min-w-[300px]">
        <MenuItem icon={Pencil} onClick={edit.ask}>
          Edit RFQ details
        </MenuItem>
        {prices ? (
          <>
            {closed && !hasLiveOrder ? (
              <MenuItem icon={FileCheck2} hint="a lost RFQ can still be won" onClick={() => setWon(true)}>
                Mark won
              </MenuItem>
            ) : null}
            {sent ? (
              <MenuItem hint="updates the date" onClick={() => void markSent(true)}>
                Quotation sent again
              </MenuItem>
            ) : (
              <MenuItem hint="no PDF" onClick={() => void markSent(false)}>
                Mark quotation sent
              </MenuItem>
            )}
            <MenuSeparator />
            {closed ? (
              <MenuItem icon={RotateCcw} onClick={() => void reopen()}>
                Reopen
              </MenuItem>
            ) : (
              <>
                <p role="none" className="px-2 pb-1 pt-1 text-sm text-fg-muted">
                  Close the RFQ because
                </p>
                {CLOSE_REASONS.map(r => (
                  <MenuItem key={r.value} hint={r.value === suggested ? 'suggested' : undefined} onClick={() => void close(r.value)}>
                    {r.label}
                  </MenuItem>
                ))}
              </>
            )}
          </>
        ) : null}
        {del.ask ? (
          <>
            <MenuSeparator />
            <MenuItem icon={Trash2} danger onClick={del.ask}>
              Delete RFQ
            </MenuItem>
          </>
        ) : null}
      </MoreMenu>
      {edit.node}
      {del.node}
    </>
  )
}
