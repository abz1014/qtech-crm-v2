import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, CloudOff, HardHat, Plus, Truck } from 'lucide-react'
import { useSession } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { useOnline } from '@/lib/connection'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { mapPgError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { CARD } from '@/ui/card'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { FoldRow } from '@/ui/FoldRow'
import { StickyActionBar } from '@/ui/StickyActionBar'
import { TextArea } from '@/ui/form/TextField'
import { useToast } from '@/ui/useToast'
import type { OrderHeader, OrderLegRow } from '@/features/orders/api'
import { deleteCapture, safely } from '@/lib/capture/store'
import { appendNotesSafely } from '@/features/capture/api'
import { appendLine } from '@/features/capture/model'
import { SHARED_GONE, useSharedItem, type SharedIn } from '@/features/jobs/sharedItem'
import { invalidateAfter } from '@/features/invalidation'
import { useMarkDone } from '@/features/orders/commissioningActions'
import { useLegActions } from '@/features/orders/useLegActions'
import { ChallansPanel } from '@/features/orders/challans/ChallansPanel'
import { VisitButton } from '@/features/orders/VisitDialog'
import { VisitsSection } from '@/features/orders/visits/VisitsSection'
import { attachmentPath, RFQ_FILE_ACCEPT } from '@/features/rfqs/lib/clarifications'
import { useUploadAttachment } from '@/features/rfqs/hooks'
import type { JobFacts } from '@/features/jobs/api'
import type { JobData } from '@/features/jobs/useJobData'

/*
 * The engineer's job page (redesign phase 7, P7-B): three big buttons, no price and no priced file anywhere.
 *   Delivered today       the goods reached the site (the supplier order's own stamp, one tap, Undo in the toast)
 *   Installed today       commissioning is done (one tap, Undo)
 *   Add photo or note     a photo from the camera (an attachment with has_prices = false) or a line of text on the order
 * Under them the order's delivery challans (view, download and print, issue a new one): goods and quantities, no price on the paper or in the lines.
 * One of them is the page's green button (the first that applies); the rest are plain. With no signal nothing is sent: the buttons are
 * off and a plain line says so, and what was typed stays in the box (there is no offline queue). Every control is 52 px tall.
 */
export const OFFLINE_TEXT = 'No connection. The note is kept and can be saved later.'

const NOTE_KEEP = 'qtech.engineer.note.'

/** The big On site button (Forest 43 engineer, .dv-card): the whole width of its cell; its words may take two lines (the supplier under them). */
const BIG = 'h-auto min-h-control-lg w-full justify-center whitespace-normal py-2 text-center leading-tight'

function LegDelivered({ order, leg, variant, offline, supplier }: { order: OrderHeader; leg: OrderLegRow; variant: 'primary' | 'secondary'; offline: boolean; supplier: string | null }) {
  const actions = useLegActions(order, leg)
  const label = supplier ? `Delivered today, ${supplier}` : 'Delivered today'
  return (
    <Button size="lg" variant={variant} icon={Truck} className={BIG} disabled={offline} busy={actions.pending} busyLabel="Saving" onClick={() => void actions.doStamp()} aria-label={label}>
      {supplier ? (
        // Two orders on their way: which supplier, in visible words on a second line (the hidden comma keeps the words one sentence).
        <span className="grid min-w-0 gap-px">
          <span>
            Delivered today<span className="sr-only">, </span>
          </span>
          <span className="text-sm font-medium [overflow-wrap:anywhere]">{supplier}</span>
        </span>
      ) : (
        label
      )}
    </Button>
  )
}

function InstalledToday({ order, variant, offline }: { order: OrderHeader; variant: 'primary' | 'secondary'; offline: boolean }) {
  const markDone = useMarkDone(order)
  return (
    <Button size="lg" variant={variant} icon={HardHat} className={BIG} disabled={offline} busy={markDone.pending} busyLabel="Saving" onClick={() => markDone.run()}>
      Installed today
    </Button>
  )
}

/**
 * The On site buttons. On a computer they are a card above the list; on a phone they are the sticky bar at the bottom (the screen's action,
 * nothing else, still named On site), so the list starts at the top of the screen. "Add photo or note" is not here: it is the one "Add to this job" row (EngineerAddRow).
 * The visit button and the offline line stay in the card on a phone too, when there is one.
 */
export function EngineerActions({ facts, data }: { facts: JobFacts; data: JobData }) {
  const order = data.order.data ?? null
  const legs = data.legs.data ?? []
  const online = useOnline()
  const offline = !online
  const phone = useMediaQuery('(max-width: 767px)')
  if (!facts.job.orderId && !facts.job.rfqId) return null

  const cancelled = order?.cancelledOn != null
  const toDeliver = order && !cancelled ? legs.filter(l => l.placedOn && !l.deliveredOn) : []
  const canInstall = Boolean(order && !cancelled && order.needsCommissioning && !order.doneOn)
  const hasDelivered = toDeliver.length > 0
  const hasButtons = hasDelivered || canInstall
  const visit = Boolean(order && order.needsCommissioning && !order.doneOn && !cancelled)
  const buttons = (
    <>
      {toDeliver.map((l, n) => (
        <LegDelivered
          key={l.id}
          order={order as OrderHeader}
          leg={l}
          offline={offline}
          variant={n === 0 ? 'primary' : 'secondary'}
          supplier={toDeliver.length > 1 ? l.supplierName : null}
        />
      ))}
      {canInstall ? <InstalledToday order={order as OrderHeader} variant={hasDelivered ? 'secondary' : 'primary'} offline={offline} /> : null}
    </>
  )
  // a phone's card holds only what the bar does not: the visit button and the offline line
  const cardOnPhone = visit || offline || (!facts.contact && Boolean(order?.site))
  const card = phone ? cardOnPhone : hasButtons || cardOnPhone
  if (!card && !(phone && hasButtons)) return null

  return (
    <>
      {card ? (
      <section aria-label={phone && hasButtons ? 'Site visit' : 'On site'} className={cn(CARD, 'mt-4 grid gap-3 p-card md:mt-6')} data-engineer-actions>
        {/* The contact row in the list has the site and the person (Call, WhatsApp); this line is only for a job with no contact. */}
        {!facts.contact && order?.site ? (
          <p className="text-base text-fg-2" data-testid="job-site">
            {[order.site.name, order.site.address].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        {offline ? (
          <p role="status" className="flex items-center gap-2 py-2 text-base text-fg-2" data-offline>
            <CloudOff aria-hidden="true" className="size-5 shrink-0" />
            {OFFLINE_TEXT}
          </p>
        ) : null}
        {/* Forest 43 (engineer): the buttons share the card's width two by two, the first that applies green, the rest white. */}
        {hasButtons && !phone ? <div className="grid items-stretch gap-3 md:grid-cols-2">{buttons}</div> : null}
        {visit ? (
          <div className="flex flex-wrap items-center gap-2">
            <VisitButton order={order as OrderHeader} size={phone ? 'lg' : 'md'} />
          </div>
        ) : null}
      </section>
      ) : null}
      {hasButtons && phone ? <StickyActionBar label="On site" role="region" primary={<div className="grid w-full gap-2">{buttons}</div>} /> : null}
    </>
  )
}

/** The visits and the delivery challans: the engineer's papers, after the list. No price on the paper or in the lines. */
export function EngineerPapers({ data }: { data: JobData }) {
  const order = data.order.data ?? null
  const cancelled = order?.cancelledOn != null
  if (!((order && order.needsCommissioning && !cancelled) || (order && data.orderItems.data))) return null
  // The same column as the step cards (the left track of the Job page's two-column grid), so the page keeps one right edge.
  return (
    <div className="mt-4 grid min-w-0 items-start gap-card-gap md:mt-6 lg:grid-cols-[minmax(0,1fr)_340px]" data-engineer-papers>
      <div className="grid min-w-0 gap-card-gap">
        {order && order.needsCommissioning && !cancelled ? <VisitsSection order={order} engineers={data.engineers.data ?? []} isEngineer canEdit card /> : null}
        {order && data.orderItems.data ? <ChallansPanel order={order} items={data.orderItems.data} /> : null}
      </div>
    </div>
  )
}

/**
 * The engineer's "Add to this job" row: the one place "Add photo or note" lives, so it appears once on the page. Closed by default with the
 * real number of things it can do (a photo, and a note when the job has an order). The Photo or note button (/capture) and a share
 * arrive with state or ?shared=<id>: the dialog opens at once, and the row with it. A share sent to this job is kept until it is saved or discarded.
 */
export function EngineerAddRow({ facts, data }: { facts: JobFacts; data: JobData }) {
  const order = data.order.data ?? null
  const online = useOnline()
  const offline = !online
  const location = useLocation()
  const navigate = useNavigate()
  const arrived = location.state as { photoOrNote?: boolean } | null
  const sharedItem = useSharedItem()
  const [adding, setAdding] = useState(Boolean(arrived?.photoOrNote) || Boolean(sharedItem.id))
  const [open, setOpen] = useState(adding)
  useEffect(() => {
    if (arrived?.photoOrNote) navigate(location.pathname + location.search, { replace: true, state: null })
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const options = facts.job.orderId && order ? 2 : 1
  return (
    <>
      <FoldRow
        state={{ icon: Plus, word: '' }}
        title="Add to this job"
        summary={`${options} ${options === 1 ? 'option' : 'options'}`}
        open={open}
        onToggle={() => setOpen(o => !o)}
        controlsId="add-to-job-body"
        bodyLabel="Add to this job"
      >
        <div className="grid gap-3">
          {offline ? (
            <p role="status" className="text-base text-fg-2" data-offline>
              {OFFLINE_TEXT}
            </p>
          ) : null}
          <Button size="lg" variant="secondary" icon={Camera} className="w-full justify-center" onClick={() => setAdding(true)}>
            Add photo or note
          </Button>
        </div>
      </FoldRow>
      {adding && sharedItem.state.status !== 'loading' ? (
        <PhotoOrNote
          facts={facts}
          order={order}
          offline={offline}
          shared={sharedItem.state.status === 'ready' ? sharedItem.state.shared : null}
          sharedGone={sharedItem.state.status === 'gone'}
          onSharedDone={sharedItem.clear}
          onClose={() => {
            if (sharedItem.state.status === 'gone') sharedItem.clear()
            setAdding(false)
          }}
        />
      ) : null}
    </>
  )
}

/** A photo (the camera on a phone) or a note, saved on the order; on the enquiry before there is one. */
/** `shared` is what the share target handed to this page; its captureId is the kept copy (IndexedDB), deleted only once it is saved or discarded. */
function PhotoOrNote({
  facts,
  order,
  offline,
  shared,
  sharedGone,
  onSharedDone,
  onClose,
}: {
  facts: JobFacts
  order: OrderHeader | null
  offline: boolean
  shared: SharedIn | null
  sharedGone: boolean
  onSharedDone: () => void
  onClose: () => void
}) {
  const { toast } = useToast()
  const session = useSession()
  const name = session.status === 'signed-in' ? session.user.name : 'Engineer'
  const orderId = facts.job.orderId ?? undefined
  const rfqId = facts.job.rfqId ?? undefined
  const upload = useUploadAttachment(orderId ? undefined : rfqId, orderId)
  const client = useQueryClient()
  const [noteBusy, setNoteBusy] = useState(false)
  const keepKey = `${NOTE_KEEP}${facts.job.key}`
  const [text, setText] = useState(() => {
    if (shared?.text?.trim()) return shared.text.trim()
    try {
      return window.sessionStorage.getItem(keepKey) ?? ''
    } catch {
      return ''
    }
  })
  useEffect(() => {
    try {
      if (text) window.sessionStorage.setItem(keepKey, text)
      else window.sessionStorage.removeItem(keepKey)
    } catch {
      /* the box still keeps what was typed while the dialog is open */
    }
  }, [text, keepKey])
  const picker = useRef<HTMLInputElement>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const canNote = Boolean(orderId && order)
  const sharedFiles = shared?.files ?? []
  const keepDone = () => {
    if (shared?.captureId) void safely(() => deleteCapture(shared.captureId as string), undefined)
    if (shared?.captureId || sharedGone) onSharedDone()
  }

  const addShared = async () => {
    const parent = orderId ?? rfqId
    if (!parent || sharedFiles.length === 0) return
    setPhotoBusy(true)
    try {
      for (const file of sharedFiles) await upload.mutateAsync({ clarificationId: null, file, path: attachmentPath(parent, crypto.randomUUID(), file.name, file.type) })
      keepDone()
      toast({ title: sharedFiles.length === 1 ? 'Photo added' : `${sharedFiles.length} photos added`, body: facts.job.companyName, tone: 'success' })
      onClose()
    } catch (err) {
      // the shared copy stays on this device: share it again or open it from Photo or note
      toast({ title: 'Could not add the shared photos', body: mapPgError(err, { entity: 'file' }).message, tone: 'danger' })
    } finally {
      setPhotoBusy(false)
    }
  }

  const addPhoto = async (file: File | undefined) => {
    if (!file) return
    const parent = orderId ?? rfqId
    if (!parent) return
    setPhotoBusy(true)
    try {
      await upload.mutateAsync({ clarificationId: null, file, path: attachmentPath(parent, crypto.randomUUID(), file.name, file.type) })
      toast({ title: 'Photo added', body: facts.job.companyName, tone: 'success' })
      onClose()
    } catch (err) {
      toast({ title: 'Could not add the photo', body: mapPgError(err, { entity: 'file' }).message, tone: 'danger' })
    } finally {
      setPhotoBusy(false)
      if (picker.current) picker.current.value = ''
    }
  }

  const saveNote = async () => {
    const line = text.trim()
    if (!line || !order) return
    const stamped = `${formatShortDate(businessToday())}, ${name}: ${line}`
    setNoteBusy(true)
    try {
      // read the notes again and add to them only if nobody saved in between (two people on one job must not overwrite each other)
      await appendNotesSafely('orders', order.id, current => appendLine(current, stamped))
      await invalidateAfter(client, 'order.update', { orderId: order.id })
      setText('')
      if (sharedFiles.length === 0) keepDone()
      toast({ title: 'Note saved', body: facts.job.companyName, tone: 'success' })
      onClose()
    } catch (err) {
      // the typing stays in the box
      toast({ title: 'Could not save the note', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
    } finally {
      setNoteBusy(false)
    }
  }

  return (
    <Dialog open busy={photoBusy || noteBusy} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        size="sm"
        icon={Camera}
        title="Add photo or note"
        context={facts.job.companyName}
        footer={
          <>
            <Button data-cancel size="lg" onClick={onClose} disabled={photoBusy || noteBusy}>
              Close
            </Button>
            {canNote ? (
              <Button size="lg" variant="primary" disabled={offline || !text.trim()} busy={noteBusy} busyLabel="Saving" onClick={() => void saveNote()}>
                Save note
              </Button>
            ) : null}
          </>
        }
      >
        <div className="grid gap-4">
          {offline ? (
            <p role="status" className="text-base text-fg-2" data-offline>
              {OFFLINE_TEXT}
            </p>
          ) : null}
          <input ref={picker} type="file" accept={`image/*,${RFQ_FILE_ACCEPT}`} capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={e => void addPhoto(e.target.files?.[0])} />
          <Button size="lg" icon={Camera} className="w-full justify-center" disabled={offline} busy={photoBusy} busyLabel="Adding" onClick={() => picker.current?.click()}>
            Take or choose a photo
          </Button>
          {sharedGone ? (
            <p role="status" className="text-base text-fg-2" data-testid="shared-gone">
              {SHARED_GONE}
            </p>
          ) : null}
          {shared?.captureId ? (
            <Button size="lg" variant="quiet" className="w-full justify-center" disabled={photoBusy || noteBusy} onClick={keepDone}>
              Discard what was shared
            </Button>
          ) : null}
          {sharedFiles.length > 0 ? (
            <Button size="lg" variant="primary" className="w-full justify-center" disabled={offline} busy={photoBusy} busyLabel="Adding" onClick={() => void addShared()}>
              {sharedFiles.length === 1 ? 'Add the shared photo' : `Add the ${sharedFiles.length} shared photos`}
            </Button>
          ) : null}
          {canNote ? (
            <label className="grid gap-2 text-base font-medium">
              Note
              <TextArea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="Observations and work done on site" />
            </label>
          ) : (
            <p className="text-base text-fg-muted">Notes go on the order. This job has no order yet, so only photos can be added.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
