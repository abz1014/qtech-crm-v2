import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, Check, Paperclip, X } from 'lucide-react'
import { useSession } from '@/app/session'
import { pastedText } from '@/lib/docread/htmlTable'
import { businessToday } from '@/lib/dates'
import { intakeFiles, type AddedFile } from '@/lib/fileIntake'
import { mapPgError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { useToast } from '@/ui/useToast'
import { Checkbox } from '@/ui/form/Checkbox'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import { deleteAttachment, type AttachmentRow, type InquiryRow, type RfqItemRow } from '@/features/rfqs/api'
import { useClarifications, useRfqInquiries, useRfqItems, useSaveReply, useSetClarificationAnswer, useSetItemDecline, useUploadAttachment } from '@/features/rfqs/hooks'
import { attachmentPath, RFQ_FILE_ACCEPT } from '@/features/rfqs/lib/clarifications'
import { currencyForSupplier, draftFromLines, draftFromSuggestions, planReplySave, suggestFromReply, type SuggestionSet } from '@/features/rfqs/lib'
import { getOrderNotes, getRfqNotes, setOrderNotes, setRfqNotes } from '@/features/capture/api'
import { appendNote, noteStamp } from '@/features/capture/model'
import type { JobSlotProps } from '@/features/jobs/slots'
import { allowedKinds, guessKind, guessLine, hasContent, KIND_LABEL, matchSupplier, type AddKind, type SupplierRef } from '@/features/jobs/addToJob/model'

/*
 * Add to this job (P4-B, plugged into the Job page's `side` slot). Paste a message, drop or take a photo, choose a file: the app
 * guesses what it is (a supplier's price, the customer's answer, a site photo, a note) and the usual case is one tap. "Change"
 * corrects the guess. This replaces the six-destination Paste or photo sheet: the job is already known, so nothing asks where it
 * goes. A supplier's reply is read into prices and saved through the same reply save as the Suppliers asked row ("Accept N
 * prices"); a customer's answer is saved on the question it answers; a photo or a file is attached; a note is appended with the
 * author and time. An engineer does not see this card (owner decision); the photo-or-note-only guard in model.ts stays as a second lock.
 *
 * It also takes what other places hand it: the share target and the "Add to job…" picker open /jobs/<key> with
 * `state.addToJob = { text, files }`, and a paste or a drop anywhere on the job page lands here.
 */
const PHOTO_TYPES = 'image/*'

/** Engineers do not see this card at all (owner decision): the wrapper mounts nothing, so none of its paste, drop or share handlers run either. */
export default function AddToJob(props: JobSlotProps) {
  if (props.job.role === 'engineer') return null
  return <AddToJobCard {...props} />
}

function AddToJobCard({ job: ctx }: JobSlotProps) {
  const { job, money } = ctx
  const rfqId = job.rfqId
  const orderId = job.orderId
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const { toast } = useToast()
  const client = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()

  const sheet = money && rfqId ? rfqId : undefined
  const inquiries = useRfqInquiries(sheet)
  const items = useRfqItems(sheet)
  const clars = useClarifications(sheet)
  const suppliers = useMemo<SupplierRef[]>(() => (inquiries.data ?? []).map(i => ({ id: i.id, name: i.supplierName })), [inquiries.data])
  const openQuestions = useMemo(() => (clars.data ?? []).filter(c => !c.answeredAt && !c.withdrawnAt), [clars.data])
  const context = useMemo(() => ({ money, hasRfq: Boolean(rfqId), suppliers, openQuestions: openQuestions.length }), [money, rfqId, suppliers, openQuestions.length])

  const [text, setText] = useState('')
  const [files, setFiles] = useState<AddedFile[]>([])
  const [kindChoice, setKindChoice] = useState<AddKind | null>(null)
  const [supplierChoice, setSupplierChoice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const good = useMemo(() => files.filter(f => !f.error), [files])

  const added = useMemo(() => ({ text, files: good.map(f => ({ name: f.file.name, type: f.file.type })) }), [text, good])
  const present = hasContent(added)
  const allowed = allowedKinds(context)
  const guessed = guessKind(added, context)
  const kind = kindChoice && allowed.includes(kindChoice) ? kindChoice : guessed
  const matched = matchSupplier(text, suppliers)
  const supplier = suppliers.find(s => s.id === supplierChoice) ?? matched

  const take = useCallback((input: { text?: string; files?: File[] }) => {
    const t = input.text?.trim()
    if (t) setText(prev => (prev.trim() ? `${prev.trimEnd()}\n${t}` : t))
    if (input.files?.length) void intakeFiles(input.files, { accept: RFQ_FILE_ACCEPT }).then(a => setFiles(prev => [...prev, ...a]))
    setKindChoice(null)
  }, [])
  const reset = () => {
    setText('')
    setFiles([])
    setKindChoice(null)
    setSupplierChoice(null)
  }

  // What the share target or "Add to job…" handed over (read once), and a paste or a drop anywhere on the page.
  const handed = useRef(false)
  useEffect(() => {
    const h = (location.state as { addToJob?: { text?: string; files?: File[] } } | null)?.addToJob
    if (!h || handed.current) return
    handed.current = true
    take({ text: h.text, files: h.files })
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate, take])
  useEffect(() => {
    const editable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return Boolean(el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName)))
    }
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || editable(e.target) || document.querySelector('[role="dialog"]')) return
      const f = [...(e.clipboardData?.files ?? [])]
      const t = e.clipboardData ? pastedText(e.clipboardData) : ''
      if (!f.length && !t.trim()) return
      e.preventDefault()
      take({ text: t, files: f })
    }
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes('Files'))
    const onOver = (e: DragEvent) => {
      if (hasFiles(e) && !document.querySelector('[role="dialog"]')) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e) || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      take({ files: [...(e.dataTransfer?.files ?? [])] })
    }
    document.addEventListener('paste', onPaste)
    document.addEventListener('dragover', onOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [take])

  // ---- saving the kinds that are the same everywhere: a photo or file, a note
  const uploadToJob = useUploadAttachment(orderId ? undefined : (rfqId ?? undefined), orderId ?? undefined)
  const uploadToRfq = useUploadAttachment(rfqId ?? undefined)
  const answerMutation = useSetClarificationAnswer(rfqId ?? '')
  const parentId = orderId ?? rfqId

  async function saveTo(kindNow: 'photo' | 'note') {
    if (busy || !parentId || !user) return
    setBusy(true)
    const rows: AttachmentRow[] = []
    try {
      // Files first: a failed upload must not leave a note written twice on Try again.
      for (const f of good) {
        rows.push(await uploadToJob.mutateAsync({ clarificationId: null, file: f.file, path: attachmentPath(parentId, crypto.randomUUID(), f.file.name, f.file.type) }))
      }
      const note = text.trim()
      let before: string | null = null
      if (note) {
        before = orderId ? await getOrderNotes(orderId) : await getRfqNotes(rfqId as string)
        const next = appendNote(before, note, noteStamp(user.name, new Date()))
        if (orderId) {
          await setOrderNotes(orderId, next)
          await invalidateAfter(client, 'order.update', { orderId })
        } else {
          await setRfqNotes(rfqId as string, next)
          await invalidateAfter(client, 'rfq.notes', { rfqId: rfqId as string })
        }
      }
      void client.invalidateQueries({ queryKey: qk.jobs.all })
      const what = [note ? 'Added to the notes' : '', rows.length ? `${rows.length} ${rows.length === 1 ? (kindNow === 'photo' ? 'photo' : 'file') : kindNow === 'photo' ? 'photos' : 'files'} attached` : ''].filter(Boolean).join(' and ')
      const keep = { text, files: good.map(f => f.file) }
      toast({
        title: `Added to Job ${job.key}`,
        body: what,
        tone: 'success',
        undo: {
          onUndo: async () => {
            if (note) {
              if (orderId) await setOrderNotes(orderId, before)
              else await setRfqNotes(rfqId as string, before)
            }
            for (const r of rows) await deleteAttachment(r)
            await Promise.all([
              orderId ? invalidateAfter(client, 'order.update', { orderId }) : invalidateAfter(client, 'rfq.notes', { rfqId: rfqId as string }),
              orderId ? invalidateAfter(client, 'order.files', { orderId }) : invalidateAfter(client, 'attachment.add', { rfqId: rfqId as string }),
              client.invalidateQueries({ queryKey: qk.jobs.all }),
            ])
            take(keep)
          },
        },
      })
      reset()
    } catch (err) {
      toast({ title: 'Could not add it', body: `${mapPgError(err).message} Nothing was lost: what you added is still here.`, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const [ticked, setTicked] = useState<ReadonlySet<string> | null>(null)
  const tickedIds = useMemo(() => ticked ?? new Set(kind === 'answer' ? (good.length > 0 && !text.trim() ? openQuestions.slice(0, 1) : openQuestions).map(q => q.id) : []), [ticked, kind, openQuestions, good.length, text])

  async function saveAnswer() {
    if (busy || !rfqId || tickedIds.size === 0) return
    setBusy(true)
    try {
      const ids = [...tickedIds]
      for (const f of good) await uploadToRfq.mutateAsync({ clarificationId: ids[0], file: f.file, path: attachmentPath(rfqId, crypto.randomUUID(), f.file.name, f.file.type) })
      const at = new Date().toISOString()
      for (const id of ids) await answerMutation.mutateAsync({ id, answer: text.trim() || null, answeredAt: at })
      void client.invalidateQueries({ queryKey: qk.jobs.all })
      toast({
        title: ids.length === 1 ? 'Answer saved' : `Answer saved on ${ids.length} questions`,
        body: `Job ${job.key}`,
        tone: 'success',
        undo: {
          onUndo: async () => {
            for (const id of ids) await answerMutation.mutateAsync({ id, answer: null, answeredAt: null })
          },
        },
      })
      reset()
      setTicked(null)
    } catch (err) {
      toast({ title: 'Could not save the answer', body: `${mapPgError(err).message} What you added is still here.`, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const primary = kind === 'answer' ? { label: tickedIds.size === 1 ? 'Save answer' : `Save answer to ${tickedIds.size} questions`, run: () => void saveAnswer(), disabled: tickedIds.size === 0 } : kind === 'photo' || kind === 'note' ? { label: kind === 'photo' ? (good.length > 1 ? `Add ${good.length} photos` : 'Add photo') : good.length > 0 && text.trim() ? 'Add note and files' : good.length > 0 ? 'Add file' : 'Add note', run: () => void saveTo(kind), disabled: !parentId } : null

  return (
    <section aria-label="Add to this job" className="rounded-panel border bg-surface" data-testid="add-to-job">
      <div className="border-b px-4 py-3">
        <h2 className="text-base font-semibold">Add to this job</h2>
        <p className="text-base text-fg-2">Paste a message, or add a photo or a file. We guess where it goes.</p>
      </div>
      <div className="grid gap-3 px-4 py-3">
        <label className="grid gap-1 text-base font-medium">
          Paste here
          <textarea
            value={text}
            rows={3}
            onChange={e => {
              setText(e.target.value)
              setKindChoice(null)
            }}
            onPaste={e => {
              const f = [...(e.clipboardData.files ?? [])]
              if (f.length) {
                e.preventDefault()
                take({ files: f })
              }
            }}
            placeholder={money ? 'A supplier’s reply, the customer’s answer, a note' : 'A note'}
            className="w-full resize-y rounded border border-line-input bg-surface px-3 py-2 text-base font-regular"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <PickButton icon={Camera} label="Take a photo" accept={PHOTO_TYPES} capture onFiles={f => take({ files: f })} />
          <PickButton icon={Paperclip} label="Choose a file" accept={RFQ_FILE_ACCEPT.join(",")} onFiles={f => take({ files: f })} />
        </div>
        {files.length > 0 ? (
          <ul className="grid gap-1" aria-label="Files to add">
            {files.map(f => (
              <li key={f.id} className="flex items-center justify-between gap-2 rounded-row border px-3 py-2 text-base">
                <span className={cn('min-w-0 [overflow-wrap:anywhere]', f.error && 'text-tone-danger-fg')}>{f.error ? `${f.file.name}: ${f.error}` : f.file.name}</span>
                <Button size="touch" variant="quiet" icon={X} aria-label={`Remove ${f.file.name}`} onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))} />
              </li>
            ))}
          </ul>
        ) : null}

        {present ? (
          <div className="grid gap-3 rounded-row border bg-canvas p-3" data-testid="add-guess">
            <p className="text-base">
              <span className="text-fg-2">This looks like: </span>
              <b className="font-semibold" data-testid="guess-line">
                {guessLine(kind, kind === 'price' ? supplier : null)}
              </b>
            </p>
            <div role="group" aria-label="Change what this is" className="flex flex-wrap gap-2">
              {allowed.map(k => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => {
                    setKindChoice(k)
                    setTicked(null)
                  }}
                  className={cn('min-h-touch rounded border px-3 text-base font-medium', kind === k ? 'border-fg bg-selected' : 'border-line-strong bg-surface hover:bg-sunken')}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>

            {kind === 'price' && rfqId && items.data ? (
              <PriceSection
                rfqId={rfqId}
                items={items.data}
                inquiries={inquiries.data ?? []}
                supplierId={supplier?.id ?? null}
                onSupplier={setSupplierChoice}
                text={text}
                files={good.map(f => f.file)}
                busy={busy}
                setBusy={setBusy}
                onDone={reset}
              />
            ) : null}

            {kind === 'answer' ? (
              <fieldset className="grid gap-2" data-testid="answer-questions">
                <legend className="mb-1 text-base font-medium">Which questions does it answer?</legend>
                {openQuestions.map(q => (
                  <Checkbox
                    key={q.id}
                    label={<span className="text-base">{q.question}</span>}
                    checked={tickedIds.has(q.id)}
                    onCheckedChange={c => {
                      const next = new Set(tickedIds)
                      if (c === true) next.add(q.id)
                      else next.delete(q.id)
                      setTicked(next)
                    }}
                  />
                ))}
              </fieldset>
            ) : null}

            {primary ? (
              <div>
                <Button variant="primary" size="touch" icon={Check} onClick={primary.run} disabled={primary.disabled} busy={busy} busyLabel="Saving" className="text-base">
                  {primary.label}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function PickButton({ icon, label, accept, capture, onFiles }: { icon: typeof Camera; label: string; accept: string; capture?: boolean; onFiles: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={!capture}
        {...(capture ? { capture: 'environment' as const } : {})}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid={capture ? 'add-photo-input' : 'add-file-input'}
        onChange={e => {
          const list = [...(e.target.files ?? [])]
          e.target.value = ''
          if (list.length) onFiles(list)
        }}
      />
      <Button size="touch" icon={icon} onClick={() => input.current?.click()} className="text-base">
        {label}
      </Button>
    </>
  )
}

/**
 * A supplier's reply read into prices: the suggestions are ticked (the unsure ones say "Check this") and "Accept N prices" saves
 * them through the reply save of the Suppliers asked row (the same plan, the same currency rules). Nothing is saved until then.
 */
function PriceSection({
  rfqId,
  items,
  inquiries,
  supplierId,
  onSupplier,
  text,
  files,
  busy,
  setBusy,
  onDone,
}: {
  rfqId: string
  items: RfqItemRow[]
  inquiries: InquiryRow[]
  supplierId: string | null
  onSupplier: (id: string) => void
  text: string
  files: File[]
  busy: boolean
  setBusy: (b: boolean) => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const save = useSaveReply(rfqId)
  const decline = useSetItemDecline(rfqId)
  const upload = useUploadAttachment(rfqId)
  const inquiry = inquiries.find(i => i.id === supplierId) ?? null
  const [set, setSet] = useState<SuggestionSet | null>(null)
  const [reading, setReading] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null)
  const [fileText, setFileText] = useState('')
  const source = text.trim() || fileText

  // A quote that arrived as a PDF or a picture, with no text: read on this device (nothing is uploaded to read it).
  const readable = files.find(f => /^image\//.test(f.type) || f.type === 'application/pdf')
  useEffect(() => {
    if (text.trim() || !readable) {
      setFileText('')
      return
    }
    let live = true
    setReading(true)
    void import('@/features/rfqs/lib/readPdf')
      .then(m => m.readDocument(readable, 'prices', {}))
      .then(r => live && setFileText('text' in r ? r.text : ''))
      .finally(() => live && setReading(false))
    return () => {
      live = false
    }
  }, [text, readable])

  useEffect(() => {
    if (!inquiry || !source.trim()) {
      setSet(null)
      return
    }
    let live = true
    const refs = items.map(it => ({ id: it.id, number: it.number, description: it.description, qty: it.qty, unit: it.unit }))
    void import('@/lib/docread/supplierQuoteParse').then(({ parseSupplierQuote }) => {
      if (!live) return
      const fallback = currencyForSupplier(inquiry.lastCurrency, inquiry.supplierCountry).currency
      setSet(suggestFromReply(parseSupplierQuote(source, refs, { today: businessToday() }), refs, fallback))
      setPicked(null)
    })
    return () => {
      live = false
    }
  }, [source, items, inquiry])

  const selected = useMemo(() => picked ?? new Set((set?.suggestions ?? []).filter(s => s.selectable).map(s => s.key)), [picked, set])

  async function accept() {
    if (!inquiry || !set || busy) return
    setBusy(true)
    try {
      for (const d of set.declined) if (inquiry.itemDeclines[d.itemId] !== d.reason) await decline.mutateAsync({ inquiryId: inquiry.id, itemId: d.itemId, reason: d.reason })
      const existing = inquiry.lines.map(l => ({ itemId: l.itemId, unitPrice: l.unitPrice, currency: l.currency, leadTime: l.leadTime, inStock: l.inStock }))
      const base = draftFromLines(existing, currencyForSupplier(inquiry.lastCurrency, inquiry.supplierCountry).currency)
      const next = draftFromSuggestions(base, set, selected)
      const plan = planReplySave(existing, next)
      if (plan.prices.length === 0 && plan.removeItemIds.length === 0) {
        toast({ title: 'Nothing to accept', body: 'Tick at least one price.' })
        return
      }
      const n = await save.mutateAsync({ inquiryId: inquiry.id, currency: next.currency, leadTime: plan.leadTime, inStock: plan.inStock, prices: plan.prices, removeItemIds: plan.removeItemIds })
      for (const f of files) await upload.mutateAsync({ clarificationId: null, file: f, path: attachmentPath(rfqId, crypto.randomUUID(), f.name, f.type) })
      toast({ title: 'Reply saved', body: `${inquiry.supplierName} · ${n} ${n === 1 ? 'price' : 'prices'}`, tone: 'success' })
      onDone()
    } catch (err) {
      toast({ title: 'Could not save the reply', body: `${mapPgError(err, { entity: 'reply' }).message} What you added is still here.`, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3" data-testid="add-price">
      <label className="grid gap-1 text-base font-medium">
        From which supplier?
        <select
          value={supplierId ?? ''}
          onChange={e => onSupplier(e.target.value)}
          className="min-h-touch rounded border border-line-input bg-surface px-3 text-base font-regular"
          aria-label="Supplier"
        >
          {supplierId ? null : <option value="">Choose the supplier</option>}
          {inquiries.map(i => (
            <option key={i.id} value={i.id}>
              {i.supplierName}
            </option>
          ))}
        </select>
      </label>
      {!inquiry ? (
        <p className="text-base text-fg-2">Choose who wrote it to read the prices.</p>
      ) : reading ? (
        <p className="text-base text-fg-2">Reading the file…</p>
      ) : !set ? null : set.question !== null ? (
        <p className="text-base text-fg-2">They are asking you something, not quoting. Nothing here is a price.</p>
      ) : set.suggestions.length === 0 ? (
        <p className="text-base text-fg-2">No price could be read. Change it to a note, or type the prices on the supplier’s row.</p>
      ) : (
        <ul className="grid gap-2" aria-label="Prices read">
          {set.suggestions.map(s => (
            <li key={s.key} className="grid gap-px">
              <Checkbox
                disabled={!s.selectable}
                label={
                  <span className="text-base">
                    Item {s.itemNumber ?? '?'}
                    {s.itemNumber ? ` · ${items.find(i => i.number === s.itemNumber)?.description ?? ''}` : ''} ·{' '}
                    <b className="num font-semibold">{s.unitPrice !== null ? `${s.currency} ${s.unitPrice.toLocaleString('en-US')}` : 'no price'}</b>
                    {s.leadTimeText ? ` · ${s.leadTimeText}` : ''}
                  </span>
                }
                checked={selected.has(s.key)}
                onCheckedChange={c => {
                  const next = new Set(selected)
                  if (c === true) next.add(s.key)
                  else next.delete(s.key)
                  setPicked(next)
                }}
              />
              {s.blocked ? <span className="pl-8 text-base text-fg-2">{s.blocked}</span> : s.check.length > 0 ? <span className="pl-8 text-base text-tone-warning-fg">Check this: {s.check.join('; ')}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {set && set.suggestions.length > 0 && inquiry ? (
        <div>
          <Button variant="primary" size="touch" icon={Check} onClick={() => void accept()} disabled={selected.size === 0} busy={busy} busyLabel="Saving" className="text-base">
            {selected.size === 1 ? 'Accept 1 price' : `Accept ${selected.size} prices`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
