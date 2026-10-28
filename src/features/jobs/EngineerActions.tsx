import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, CloudOff, FileText, HardHat, Truck } from 'lucide-react'
import { useSession } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { useOnline } from '@/lib/connection'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { TextArea } from '@/ui/form/TextField'
import { useToast } from '@/ui/useToast'
import type { OrderHeader, OrderLegRow } from '@/features/orders/api'
import { deleteCapture, safely } from '@/lib/capture/store'
import { appendNotesSafely } from '@/features/capture/api'
import { appendLine } from '@/features/capture/model'
import { invalidateAfter } from '@/features/invalidation'
import { useMarkDone } from '@/features/orders/commissioningActions'
import { useLegActions } from '@/features/orders/useLegActions'
import { VisitButton } from '@/features/orders/VisitDialog'
import { attachmentPath, RFQ_FILE_ACCEPT } from '@/features/rfqs/lib/clarifications'
import { useUploadAttachment } from '@/features/rfqs/hooks'
import type { JobFacts } from '@/features/jobs/api'
import type { JobData } from '@/features/jobs/useJobData'

/*
 * The engineer's job page (redesign phase 7, P7-B): three big buttons, no price and no priced file anywhere.
 *   Delivered today       the goods reached the site (the supplier order's own stamp, one tap, Undo in the toast)
 *   Installed today       commissioning is done (one tap, Undo)
 *   Add photo or note     a photo from the camera (an attachment with has_prices = false) or a line of text on the order
 * One of them is the page's green button (the first that applies); the rest are plain. With no signal nothing is sent: the buttons are
 * off and a plain line says so, and what was typed stays in the box (there is no offline queue). Every control is 52 px tall.
 */
export const OFFLINE_TEXT = 'Needs signal to save. Your typing is kept.'

const NOTE_KEEP = 'qtech.engineer.note.'

function LegDelivered({ order, leg, variant, offline, label }: { order: OrderHeader; leg: OrderLegRow; variant: 'primary' | 'secondary'; offline: boolean; label: string }) {
  const actions = useLegActions(order, leg)
  return (
    <Button size="lg" variant={variant} icon={Truck} className="w-full justify-center" disabled={offline} busy={actions.pending} busyLabel="Saving" onClick={() => void actions.doStamp()} aria-label={label}>
      Delivered today
    </Button>
  )
}

function InstalledToday({ order, variant, offline }: { order: OrderHeader; variant: 'primary' | 'secondary'; offline: boolean }) {
  const markDone = useMarkDone(order)
  return (
    <Button size="lg" variant={variant} icon={HardHat} className="w-full justify-center" disabled={offline} busy={markDone.pending} busyLabel="Saving" onClick={() => markDone.run()}>
      Installed today
    </Button>
  )
}

export function EngineerActions({ facts, data }: { facts: JobFacts; data: JobData }) {
  const order = data.order.data ?? null
  const legs = data.legs.data ?? []
  const online = useOnline()
  const offline = !online
  // The engineer's Photo or note button (/capture) and a share sent to a job arrive with this state: open the box at once (read once, then cleared).
  const location = useLocation()
  const navigate = useNavigate()
  const arrived = location.state as { photoOrNote?: boolean; addToJob?: SharedIn } | null
  const [shared] = useState<SharedIn | null>(() => arrived?.addToJob ?? null)
  const [adding, setAdding] = useState(Boolean(arrived?.photoOrNote || arrived?.addToJob))
  useEffect(() => {
    if (arrived?.photoOrNote || arrived?.addToJob) navigate(location.pathname + location.search, { replace: true, state: null })
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!facts.job.orderId && !facts.job.rfqId) return null

  const cancelled = order?.cancelledOn != null
  const toDeliver = order && !cancelled ? legs.filter(l => l.placedOn && !l.deliveredOn) : []
  const canInstall = Boolean(order && !cancelled && order.needsCommissioning && !order.doneOn)
  const hasDelivered = toDeliver.length > 0
  // The one green button: the first thing there is to do on site; Add photo or note when there is nothing else.
  const photoVariant = hasDelivered || canInstall ? 'secondary' : 'primary'

  return (
    <section aria-label="On site" className="mt-4 grid gap-3 rounded-panel border border-line-strong bg-surface px-4 py-4 md:px-5" data-engineer-actions>
      <h2 className="text-lg font-semibold">On site</h2>
      {offline ? (
        <p role="status" className="flex items-center gap-2 rounded border border-dashed border-line-strong px-3 py-3 text-base text-fg-2" data-offline>
          <CloudOff aria-hidden="true" className="size-5 shrink-0" />
          {OFFLINE_TEXT}
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        {toDeliver.map((l, n) => (
          <LegDelivered
            key={l.id}
            order={order as OrderHeader}
            leg={l}
            offline={offline}
            variant={n === 0 ? 'primary' : 'secondary'}
            label={toDeliver.length > 1 ? `Delivered today, ${l.supplierName}` : 'Delivered today'}
          />
        ))}
        {canInstall ? <InstalledToday order={order as OrderHeader} variant={hasDelivered ? 'secondary' : 'primary'} offline={offline} /> : null}
        <Button size="lg" variant={photoVariant} icon={Camera} className="w-full justify-center" onClick={() => setAdding(true)}>
          Add photo or note
        </Button>
      </div>
      {order || facts.job.orderId ? (
        <div className="flex flex-wrap items-center gap-2">
          {order && order.needsCommissioning && !order.doneOn && !cancelled ? <VisitButton order={order} /> : null}
          {facts.job.orderId ? (
            <Link to={`/orders/${facts.job.orderId}`} className="inline-flex min-h-touch items-center gap-2 rounded px-3 text-base font-semibold text-primary hover:underline">
              <FileText aria-hidden="true" className="size-5" />
              Open the order
            </Link>
          ) : null}
        </div>
      ) : null}
      {adding ? <PhotoOrNote facts={facts} order={order} offline={offline} shared={shared} onClose={() => setAdding(false)} /> : null}
    </section>
  )
}

/** A photo (the camera on a phone) or a note, saved on the order; on the enquiry before there is one. */
/** What the share target or "Add to job…" handed to this page; captureId is the kept copy (IndexedDB), deleted only once it is saved. */
interface SharedIn {
  text?: string
  files?: File[]
  captureId?: string
}

function PhotoOrNote({ facts, order, offline, shared, onClose }: { facts: JobFacts; order: OrderHeader | null; offline: boolean; shared: SharedIn | null; onClose: () => void }) {
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
          {sharedFiles.length > 0 ? (
            <Button size="lg" variant="primary" className="w-full justify-center" disabled={offline} busy={photoBusy} busyLabel="Adding" onClick={() => void addShared()}>
              {sharedFiles.length === 1 ? 'Add the shared photo' : `Add the ${sharedFiles.length} shared photos`}
            </Button>
          ) : null}
          {canNote ? (
            <label className="grid gap-2 text-base font-medium">
              Note
              <TextArea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="What you saw or did on site" />
            </label>
          ) : (
            <p className="text-base text-fg-muted">Notes go on the order. This job has no order yet, so only photos can be added.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
