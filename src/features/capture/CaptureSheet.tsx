import { useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Import, WifiOff } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { deleteCapture, safely } from '@/lib/capture/store'
import { readRecents } from '@/lib/capture/recents'
import { qk } from '@/features/queryKeys'
import { invalidateAfter } from '@/features/invalidation'
import { useSession } from '@/app/session'
import { listCandidates, getRfqNotes, setRfqNotes } from '@/features/capture/api'
import {
  appendNote,
  availability,
  countsText,
  defaultRfq,
  defaultTicks,
  guessDestination,
  noteStamp,
  orderCandidates,
  payloadKind,
  saveLabel,
  savedSummary,
  type Candidate,
  type Dest,
} from '@/features/capture/model'
import { CaptureArea, RfqPicker, SavedPanel, Tiles } from '@/features/capture/CaptureParts'
import { useCapture } from '@/app/capture/useCapture'
import { useCompanyMatches, useRfqInquiries } from '@/features/rfqs/hooks'
import {
  addClarifications,
  deleteAttachment,
  listClarifications,
  setClarificationAnswer,
  setClarificationWithdrawn,
  uploadAttachment,
  type AttachmentRow,
} from '@/features/rfqs/api'
import { attachmentPath, clarState, splitQuestions } from '@/features/rfqs/lib/clarifications'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Kbd } from '@/ui/Kbd'
import { Checkbox } from '@/ui/form/Checkbox'
import { Combobox } from '@/ui/form/Combobox'
import { Field } from '@/ui/form/Field'
import { Radio, RadioGroup } from '@/ui/form/Radio'
import { useToast } from '@/ui/useToast'

/*
 * The Capture sheet (R22; docs/design/mockups/g2-capture.html). A modal on desktop, a bottom sheet on a phone.
 *
 * Two short questions on one screen: what to do with it, and on which RFQ. The most likely answer to each is already chosen,
 * so the common case is one tap on the primary button:
 *   photo that answers a question   Share, Q-Tech CRM, then "Save photo as the answer": nothing typed.
 *   text that answers questions     the same, "Save answer to 2 questions".
 * Every destination ends within 3 taps once the sheet is open: choose what to do, choose the RFQ, Save.
 * Saves keep a 10 second Undo that puts the draft back.
 */
const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)

interface Result {
  dest: Dest
  rfq: Candidate
  summary: string
}

export default function CaptureSheet() {
  const cap = useCapture()
  const { draft } = cap
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const navigate = useNavigate()
  const client = useQueryClient()
  const { toast } = useToast()
  const online = useOnline()

  const goodFiles = draft.files.filter(f => !f.error)
  const kind = payloadKind(draft.text, goodFiles.length)
  const now = useRef(Date.now()).current

  // ---- the RFQs on offer
  const candidatesQuery = useQuery({
    queryKey: qk.rfqs.capture(user?.id ?? ''),
    queryFn: () => listCandidates(readRecents(), user?.id ?? ''),
    enabled: Boolean(user),
    staleTime: 10_000,
  })
  const [extra, setExtra] = useState<Candidate | null>(null)
  const ordered = useMemo(() => {
    const base = (candidatesQuery.data ?? []).filter(c => c.id !== extra?.id)
    return orderCandidates(extra ? [{ ...extra, openedAt: now }, ...base] : base, now)
  }, [candidatesQuery.data, extra, now])

  // ---- what the person has chosen so far (nothing, until they change the pre-selection)
  const [userDest, setUserDest] = useState<Dest | null>(null)
  const [userRfqId, setUserRfqId] = useState<string | null>(null)
  const [tickState, setTickState] = useState<{ rfqId: string; ids: Set<string> } | null>(null)
  const [lineOff, setLineOff] = useState<Set<string>>(new Set())
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null)
  const [companyText, setCompanyText] = useState('')
  const [inquiryPick, setInquiryPick] = useState<string | null>(null)

  const dest: Dest = userDest ?? guessDestination(kind, draft.text, ordered)
  const rfq = ordered.find(c => c.id === userRfqId) ?? defaultRfq(dest, ordered)
  const open = rfq?.open ?? []
  const ticked = tickState && rfq && tickState.rfqId === rfq.id ? tickState.ids : new Set(defaultTicks(kind, open))
  const tickedList = open.filter(q => ticked.has(q.id))
  const lines = splitQuestions(draft.text)
  const keptLines = lines.filter(l => !lineOff.has(l))

  const companies = useCompanyMatches(companyText)
  const inquiries = useRfqInquiries(dest === 'reply' ? rfq?.id : undefined)
  const inquiryList = inquiries.data ?? []
  const inquiryId = inquiryPick ?? (inquiryList.find(i => i.lines.length === 0)?.id ?? inquiryList[0]?.id ?? null)

  const unavailable: Partial<Record<Dest, string>> = {}
  const noRfq = ordered.length === 0
  for (const d of ['answer', 'questions', 'notes', 'new-rfq', 'reply'] as const) {
    const a = availability(d, kind, null)
    if (!a.ok) unavailable[d] = a.reason
  }

  // ---- saving
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const inFlight = useRef(false)
  const uploaded = useRef(new Map<string, AttachmentRow>())

  const needsRfq = dest !== 'new-rfq'
  const ready =
    kind !== 'empty' &&
    online &&
    (dest === 'new-rfq' ? Boolean(company) : Boolean(rfq)) &&
    (dest === 'answer' ? tickedList.length > 0 : true) &&
    (dest === 'questions' ? keptLines.length > 0 : true) &&
    (dest === 'reply' ? Boolean(inquiryId) : true)
  const label = saveLabel({ dest, kind, ticked: tickedList.length, questionLines: keptLines.length })

  async function attachFiles(rfqId: string, clarificationId: string | null): Promise<AttachmentRow[]> {
    const out: AttachmentRow[] = []
    for (const f of goodFiles) {
      let row = uploaded.current.get(f.id)
      if (!row) {
        row = await uploadAttachment({ rfqId, clarificationId, file: f.file, path: attachmentPath(rfqId, crypto.randomUUID(), f.file.name, f.file.type) })
        uploaded.current.set(f.id, row)
      }
      out.push(row)
    }
    return out
  }

  async function refresh(rfqId: string, writes: ('clarification.answer' | 'clarification.add' | 'attachment.add' | 'rfq.notes')[]) {
    await Promise.all([
      ...writes.map(w => invalidateAfter(client, w, { rfqId })),
      client.invalidateQueries({ queryKey: qk.today.all }),
      client.invalidateQueries({ queryKey: qk.rfqs.capture() }),
    ])
  }

  async function save() {
    if (inFlight.current || !ready || !user) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    const text = draft.text.trim()
    const keep = { text: draft.text, files: goodFiles.map(f => f.file), source: draft.source }
    // Put the capture back after an Undo, so nothing the person gave us is lost by a tap.
    const restore = () => cap.add({ text: keep.text, files: keep.files }, keep.source)
    try {
      if (dest === 'new-rfq' && company) {
        cap.close()
        navigate(`/rfqs/new?company=${company.id}`, { state: { capture: { id: draft.id, text: draft.text, files: keep.files } } })
        return
      }
      if (!rfq) return
      const rfqId = rfq.id
      const ref = rfqRef(rfq.number)

      if (dest === 'reply' && inquiryId) {
        await attachFiles(rfqId, null)
        await refresh(rfqId, goodFiles.length ? ['attachment.add'] : [])
        cap.close()
        cap.discard()
        navigate(`/rfqs/${rfqId}`, { state: { reply: { inquiryId, text: draft.text } } })
        return
      }

      let undo: () => Promise<void>
      let summary: string
      if (dest === 'answer') {
        const ids = tickedList.map(q => q.id)
        const rows = await attachFiles(rfqId, ids[0])
        const at = new Date().toISOString()
        for (const id of ids) await setClarificationAnswer({ id, answer: text || null, answeredAt: at })
        await refresh(rfqId, ['clarification.answer', ...(rows.length ? (['attachment.add'] as const) : [])])
        summary = savedSummary('answer', { questions: ids.length, photos: rows.length })
        undo = async () => {
          for (const id of ids) await setClarificationAnswer({ id, answer: null, answeredAt: null })
          for (const r of rows) await deleteAttachment(r)
          await refresh(rfqId, ['clarification.answer', 'attachment.add'])
        }
      } else if (dest === 'questions') {
        const qs = keptLines.map(question => ({ id: crypto.randomUUID(), question, inquiryId: null }))
        await addClarifications(rfqId, qs)
        const rows = await attachFiles(rfqId, null)
        await refresh(rfqId, ['clarification.add', ...(rows.length ? (['attachment.add'] as const) : [])])
        summary = savedSummary('questions', { questions: qs.length, photos: rows.length })
        undo = async () => {
          const when = new Date().toISOString()
          for (const q of qs) await setClarificationWithdrawn(q.id, when)
          for (const r of rows) await deleteAttachment(r)
          await refresh(rfqId, ['clarification.add', 'attachment.add'])
        }
      } else {
        const before = await getRfqNotes(rfqId)
        if (text) await setRfqNotes(rfqId, appendNote(before, text, noteStamp(user.name, new Date())))
        const rows = await attachFiles(rfqId, null)
        await refresh(rfqId, ['rfq.notes', ...(rows.length ? (['attachment.add'] as const) : [])])
        summary = savedSummary('notes', { questions: 0, photos: rows.length })
        undo = async () => {
          if (text) await setRfqNotes(rfqId, before)
          for (const r of rows) await deleteAttachment(r)
          await refresh(rfqId, ['rfq.notes', 'attachment.add'])
        }
      }

      await safely(() => deleteCapture(draft.id), undefined)
      uploaded.current.clear()
      setResult({ dest, rfq, summary })
      cap.discard()
      toast({
        title: `Saved to ${ref}`,
        body: summary.replace(/\.$/, ''),
        tone: 'success',
        undo: {
          onUndo: async () => {
            try {
              await undo()
              setResult(null)
              restore()
            } catch (err) {
              toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
          },
        },
      })
    } catch (err) {
      setError(mapPgError(err, { entity: 'capture' }).message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void save()
    }
  }

  async function pickRfq(c: Candidate) {
    setUserRfqId(c.id)
    setTickState(null)
    if (!ordered.some(o => o.id === c.id)) {
      // Found by search: read its questions so an answer can be given to it too.
      const clars = await listClarifications(c.id).catch(() => [])
      const open = clars
        .filter(q => !q.withdrawnAt && !q.answeredAt)
        .map(q => ({ id: q.id, question: q.question, asked: clarState(q) === 'asked', createdAt: q.createdAt }))
      setExtra({ ...c, open })
    }
  }

  const onChoose = (d: Dest) => {
    setUserDest(d)
    setTickState(null)
  }

  const sourceNote = draft.source === 'share' ? 'Shared from WhatsApp' : draft.source === 'drop' ? 'Dropped' : draft.source === 'paste' ? 'Pasted' : null

  return (
    <Dialog open onOpenChange={o => !o && cap.close()} busy={busy}>
      <DialogContent
        title="Capture"
        context="Text, photos and files from WhatsApp or anywhere else. Choose where they go."
        icon={Import}
        size="lg"
        className="md:w-[920px]"
        lead={result ? undefined : <span className="hidden items-center gap-1 text-xs text-fg-muted md:inline-flex"><Kbd>⌘</Kbd><Kbd>↵</Kbd> saves</span>}
        footer={
          result ? undefined : (
            <>
              <Button data-cancel onClick={cap.close}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void save()} disabled={!ready} busy={busy} busyLabel="Saving">
                {kind === 'empty' ? 'Add something first' : label}
              </Button>
            </>
          )
        }
      >
        <div data-capture-body onKeyDown={onKey} className="grid gap-4">
          {cap.notice === 'back' ? (
            <Banner tone="info" title="Your shared item is back">
              Choose where it goes to finish.
            </Banner>
          ) : null}
          {cap.notice === 'expired' ? (
            <Banner tone="warning" title="The shared item is no longer on this phone">
              Shared items are kept for 7 days. Share it again from WhatsApp, or paste it.
            </Banner>
          ) : null}
          {!online ? (
            <div role="status" className="flex items-start gap-3 rounded border border-tone-warning-fg/25 bg-tone-warning-bg px-4 py-3 text-sm">
              <WifiOff aria-hidden="true" size={16} className="mt-[2px] shrink-0 text-tone-warning-fg" />
              <div className="grid">
                <b className="font-semibold">You are offline</b>
                <span className="text-fg-2">Your capture is kept on this phone. Save when you are back online.</span>
              </div>
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="flex items-start gap-3 rounded border border-tone-danger-fg/25 bg-tone-danger-bg px-4 py-3 text-sm">
              <CircleAlert aria-hidden="true" size={16} className="mt-[2px] shrink-0 text-tone-danger-fg" />
              <div className="grid flex-1">
                <b className="font-semibold">Couldn’t save</b>
                <span className="text-fg-2">{error} Nothing was changed and your capture is still here.</span>
              </div>
              <Button size="sm" onClick={() => void save()} disabled={busy}>
                Try again
              </Button>
            </div>
          ) : null}

          {result ? (
            <SavedPanel
              title={`Saved to ${rfqRef(result.rfq.number)}`}
              summary={result.summary}
              rows={[
                ['RFQ', `${rfqRef(result.rfq.number)} · ${result.rfq.companyName}`],
                ...(result.dest === 'answer' ? ([['Next', 'Answers to relay']] as [string, string][]) : []),
              ]}
            >
              <Button
                variant="primary"
                onClick={() => {
                  cap.close()
                  navigate(`/rfqs/${result.rfq.id}`)
                }}
              >
                {`Open ${rfqRef(result.rfq.number)}`}
              </Button>
              <Button onClick={() => setResult(null)}>Capture another</Button>
              <Button variant="quiet" onClick={cap.close}>
                Done
              </Button>
            </SavedPanel>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              <div className="grid content-start gap-2">
                {sourceNote ? <p className="text-xs text-fg-muted md:hidden">{sourceNote}</p> : null}
                <CaptureArea
                  text={draft.text}
                  files={draft.files}
                  dragging={cap.dragging}
                  autoFocus={draft.source === 'pick'}
                  onText={cap.setText}
                  onFiles={files => cap.add({ files }, 'pick')}
                  onRemove={cap.removeFile}
                  onDiscard={() => {
                    cap.discard()
                    setUserDest(null)
                    setUserRfqId(null)
                    setTickState(null)
                  }}
                  count={countsText(draft.text, goodFiles.length)}
                />
              </div>

              <div className="grid content-start gap-4">
                <section aria-label="What to do" className="grid gap-2">
                  <h3 className="text-sm font-semibold text-fg">What should we do with it?</h3>
                  <Tiles chosen={dest} kind={kind} unavailable={unavailable} onChoose={onChoose} />
                  {kind === 'empty' ? <p className="text-xs text-fg-muted">You choose after you add something.</p> : null}
                </section>

                {kind !== 'empty' && needsRfq ? (
                  <>
                    {noRfq && !candidatesQuery.isPending ? (
                      <p className="text-sm text-fg-muted">No RFQ opened lately and none of yours has a question waiting. Search all RFQs to choose one.</p>
                    ) : null}
                    <RfqPicker list={ordered} chosenId={rfq?.id ?? null} now={now} onPick={pickRfq} />
                    {rfq && dest === 'answer' ? (
                      <>
                        <p className="flex gap-2 text-xs text-fg-muted">
                          {open.length === 0
                            ? `${rfqRef(rfq.number)} has no open questions. Choose another RFQ, or add this to its notes.`
                            : `Answers ${open.length === 1 ? '1 open question' : `${ticked.size} of ${open.length} open questions`} on ${rfqRef(rfq.number)}. Untick any this does not answer.`}
                        </p>
                        <ul className="grid gap-1">
                          {open.map(q => (
                            <li key={q.id} className="rounded border bg-surface px-3 py-2 data-[on=true]:bg-sunken" data-on={ticked.has(q.id)}>
                              <Checkbox
                                label={q.question}
                                checked={ticked.has(q.id)}
                                onCheckedChange={on => {
                                  const ids = new Set(ticked)
                                  if (on) ids.add(q.id)
                                  else ids.delete(q.id)
                                  setTickState({ rfqId: rfq.id, ids })
                                }}
                              />
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {rfq && dest === 'questions' ? (
                      <>
                        <h3 className="text-sm font-semibold text-fg">{`Split into ${lines.length} ${lines.length === 1 ? 'question' : 'questions'}`}</h3>
                        <ul className="grid gap-1">
                          {lines.map(l => (
                            <li key={l} className="rounded border bg-surface px-3 py-2">
                              <Checkbox
                                label={l}
                                checked={!lineOff.has(l)}
                                onCheckedChange={on =>
                                  setLineOff(prev => {
                                    const next = new Set(prev)
                                    if (on) next.delete(l)
                                    else next.add(l)
                                    return next
                                  })
                                }
                              />
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {rfq && dest === 'notes' ? (
                      <p className="text-xs text-fg-muted">
                        {draft.text.trim()
                          ? `Added to the notes of ${rfqRef(rfq.number)} as written, with your name and the time: “${noteStamp(user?.name ?? 'You', new Date())}”.`
                          : `The files are kept with ${rfqRef(rfq.number)}.`}
                      </p>
                    ) : null}
                    {rfq && dest === 'reply' ? (
                      <section aria-label="Which supplier replied" className="grid gap-2">
                        <h3 className="text-sm font-semibold text-fg">Which supplier replied?</h3>
                        {inquiryList.length === 0 && !inquiries.isPending ? <p className="text-sm text-fg-muted">No supplier has been asked on this RFQ yet.</p> : null}
                        <RadioGroup value={inquiryId ?? ''} onValueChange={setInquiryPick} aria-label="Supplier">
                          {inquiryList.map(i => (
                            <Radio key={i.id} value={i.id} label={i.supplierName} help={i.lines.length ? 'Has a reply saved' : undefined} />
                          ))}
                        </RadioGroup>
                        <p className="text-xs text-fg-muted">The RFQ opens with the reply read out. Nothing is saved until you accept.</p>
                      </section>
                    ) : null}
                  </>
                ) : null}

                {kind !== 'empty' && dest === 'new-rfq' ? (
                  <section aria-label="Which company" className="grid gap-2">
                    <Field label="Which company?" id="capture-company">
                      <Combobox
                        options={(companies.data ?? []).map(c => ({ value: c.id, label: c.name, meta: c.country ?? undefined }))}
                        value={company?.id ?? ''}
                        onChange={id => {
                          const hit = (companies.data ?? []).find(c => c.id === id)
                          setCompany(hit ? { id: hit.id, name: hit.name } : null)
                        }}
                        onQueryChange={setCompanyText}
                        loading={companies.isFetching}
                        placeholder="Start typing the company"
                      />
                    </Field>
                    <p className="text-xs text-fg-muted">Intake opens with this text and the company already filled. Nothing is saved until you create the RFQ.</p>
                  </section>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
