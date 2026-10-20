import { useMemo, useState } from 'react'
import { useChannelPreference, type ContactChannel } from '@/lib/useChannelPreference'
import { Check, MessageSquareWarning, Phone } from 'lucide-react'
import { useSession } from '@/app/session'
import { copyToClipboard } from '@/lib/clipboard'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { MessageActions } from '@/ui/MessageActions'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { chaseClipboardText, COMPANY_NAME } from '@/features/rfqs/lib'
import { buildGoodsDraft } from '@/features/today/chaseDraft'
import { performChase, useLegDraft, useRefreshAfterChase } from '@/features/today/hooks'
import type { OrderHeader, OrderLegRow } from '@/features/orders/api'
import { useMyJobTitle } from '@/features/orders/hooks'

/*
 * Goods chase from the order page (O03). It reuses the R16 generator (buildGoodsDraft, so the wording, the reference and the firmer tone
 * after 30 days are the same as on Today) and the R16 stamp (stamp_goods_chase through performChase, with the same 10 s Undo).
 * "Copy message and mark chased" is one tap: copy, stamp, Undo.
 */
export function GoodsChaseDialog({ order, leg, onClose }: { order: OrderHeader; leg: OrderLegRow; onClose: () => void }) {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const { toast } = useToast()
  const refresh = useRefreshAfterChase()
  const draftData = useLegDraft(leg.id)
  const jobTitle = useMyJobTitle(user?.id)
  // the person's last WhatsApp / Email choice, remembered on this device (useChannelPreference)
  const [channel, setChannel] = useChannelPreference()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  // A WhatsApp / email link was opened: the dialog stays open and offers "Mark chased" (opening never marks).
  const [opened, setOpened] = useState(false)
  const today = businessToday()

  const draft = useMemo(() => {
    if (!draftData.data || !leg.expectedOn) return null
    return buildGoodsDraft({
      leg: {
        id: leg.id,
        orderId: order.id,
        orderNumber: order.number,
        ownerId: order.owner?.id ?? null,
        customerName: order.companyName,
        supplierName: leg.supplierName,
        reference: leg.reference,
        orderedOn: order.orderedOn,
        placedOn: leg.placedOn,
        expectedOn: leg.expectedOn,
        receivedOn: leg.receivedOn,
        deliveredOn: leg.deliveredOn,
        lastChasedOn: leg.lastChasedOn,
        chaseCount: leg.chaseCount,
      },
      data: draftData.data,
      today,
      signature: { name: user?.name ?? COMPANY_NAME, company: COMPANY_NAME, jobTitle: jobTitle.data ?? null },
    })
  }, [draftData.data, leg, order, today, user?.name, jobTitle.data])

  const text = draft ? chaseClipboardText(channel === 'email' ? draft.email : draft.whatsapp) : ''

  /** Stamps the chase with Undo and closes the dialog. `copied`: the copy button did it, else a link was opened. */
  const mark = async (copied: boolean) => {
    try {
      const r = await performChase({ kind: 'goods', legId: leg.id, before: { lastChasedOn: leg.lastChasedOn, chaseCount: leg.chaseCount } })
      setCopied(true)
      toast({
        title: `${copied ? 'Copied. ' : ''}${leg.supplierName} marked chased.`,
        body: orderRef(order.number),
        tone: 'success',
        undo: {
          seconds: 10,
          onUndo: async () => {
            try {
              await r.undo()
              setCopied(false)
            } finally {
              void refresh()
            }
          },
          onSettle: () => void refresh(),
          settledTitle: `${leg.supplierName} marked chased`,
          undoneTitle: 'Undone.',
          undoneBody: `${leg.supplierName} is not marked chased.`,
        },
      })
      onClose()
    } catch (err) {
      toast({ title: copied ? 'Copied, but it was not marked' : 'It was not marked', body: mapPgError(err).message, tone: 'danger' })
    }
  }

  const copyAndMark = async () => {
    if (!draft || busy) return
    setBusy(true)
    try {
      // The copy comes first inside the tap: a browser only allows it during the gesture.
      if (!(await copyToClipboard(text))) {
        toast({ title: 'Could not copy the message', body: 'Select the text and copy it by hand. Nothing was marked.', tone: 'danger' })
        return
      }
      await mark(true)
    } finally {
      setBusy(false)
    }
  }

  const markOnly = async () => {
    if (!draft || busy) return
    setBusy(true)
    try {
      await mark(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open busy={busy} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        size="lg"
        title="Chase the goods"
        context={`${orderRef(order.number)} · ${leg.supplierName}${leg.expectedOn ? ` · expected ${formatDay(leg.expectedOn)}` : ''}`}
        icon={MessageSquareWarning}
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={busy}>
              Close
            </Button>
            {copied ? (
              <Button icon={Check} disabled>
                Marked chased today
              </Button>
            ) : draft ? (
              <>
                <MessageActions
                  to={draft.contact}
                  text={draft.whatsapp.body}
                  email={{ subject: draft.email.subject, body: draft.email.body }}
                  variant={opened ? 'secondary' : 'primary'}
                  copy={{ label: 'Copy message and mark chased', onCopy: copyAndMark, busy, busyLabel: 'Marking' }}
                  onOpen={() => setOpened(true)}
                  channel={channel}
                  onChannelChange={setChannel}
                />
                {opened ? (
                  <Button variant="primary" icon={Check} busy={busy} busyLabel="Marking" onClick={() => void markOnly()}>
                    Mark chased
                  </Button>
                ) : null}
              </>
            ) : (
              <Button variant="primary" disabled>
                Copy message and mark chased
              </Button>
            )}
          </>
        }
      >
        <div className="grid gap-3">
          {!leg.expectedOn ? (
            <Banner tone="warning" title="No expected date for these goods">
              The message asks about the expected date, so set one on the supplier order first.
            </Banner>
          ) : draftData.isPending ? (
            <div className="grid gap-2" aria-busy="true" aria-label="Preparing the message">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : draftData.isError ? (
            <Banner tone="danger" title="Couldn't prepare the message" action={<Button onClick={() => void draftData.refetch()}>Try again</Button>}>
              Nothing was changed.
            </Banner>
          ) : draft ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm text-fg-2">
                  <Phone className="size-[14px] text-fg-muted" aria-hidden="true" />
                  {draft.contact ? `To ${draft.contact.name}${draft.contact.phone ? ` · ${draft.contact.phone}` : ''}` : 'No contact on record'}
                </span>
                <SegmentedControl
                  aria-label="Message channel"
                  value={channel}
                  onValueChange={v => setChannel(v as ContactChannel)}
                  options={[
                    { value: 'whatsapp', label: 'WhatsApp' },
                    { value: 'email', label: 'Email' },
                  ]}
                />
              </div>
              <pre data-testid="draft-text" className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border bg-sunken p-3 font-sans text-sm text-fg">
                {channel === 'email' && draft.email.subject ? `Subject: ${draft.email.subject}\n\n` : ''}
                {(channel === 'email' ? draft.email : draft.whatsapp).body}
              </pre>
              <p className="text-xs text-fg-muted">
                Copying records a chase today (chased ×{draft.countAfter}). Asks for a dispatch date by {formatDay(draft.answerBy ?? today)}.
                {draft.firm ? ' Firmer wording, because it is more than 30 days late.' : ''}
              </p>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
