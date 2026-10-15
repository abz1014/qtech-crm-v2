import { useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as RadixDialog from '@radix-ui/react-dialog'
import { ArrowRight, ClipboardPaste, Clock, FileWarning, Share2, WifiOff, X } from 'lucide-react'
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
  countsText,
  defaultRfq,
  defaultTicks,
  guessDestination,
  noteStamp,
  orderCandidates,
  payloadKind,
  saveLabel,
  savedSummary,
  shortQuestion,
  type Candidate,
  type Dest,
} from '@/features/capture/model'
import { CapNote, CaptureArea, QuestionPick, RfqPicker, SavedPanel, Section, SplitRows, Tiles } from '@/features/capture/CaptureParts'
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
import { formatBytes } from '@/lib/fileIntake'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { Combobox } from '@/ui/form/Combobox'
import { Radio, RadioGroup } from '@/ui/form/Radio'
import { useToast } from '@/ui/useToast'

/*
 * The Capture sheet (R22; docs/design/mockups/g2-capture.html). A 960 px modal on desktop with two columns, a full-screen sheet on a
 * phone with the Save button at the bottom.
 *
 * Two short questions on one screen: what to do with it, and on which RFQ. The most likely answer to each is already chosen, so
 * the common case is one tap on the primary button:
 *   photo that answers a question   Share, Q-Tech CRM, then "Save photo as the answer": nothing typed.
 *   text that answers questions     the same, "Save answer to 2 questions".
 * Every destination ends within 3 taps once the sheet is open: choose what to do, choose the RFQ, Save.
 * Saves keep a 10 second Undo that puts the capture back.
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
  rfq: Candidate
  summary: string
  answered?: number
}

const sizeOf = (error: string) => /^([\d.]+ [KM]B)/.exec(error)?.[1] ?? ''

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
  const badFiles = draft.files.filter(f => f.error)
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

  // ---- saving
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const inFlight = useRef(false)
  const uploaded = useRef(new Map<string, AttachmentRow>())

  const ready =
    kind !== 'empty' &&
    online &&
    (dest === 'new-rfq' ? Boolean(company) : Boolean(rfq)) &&
    (dest === 'answer' ? tickedList.length > 0 : true) &&
    (dest === 'questions' ? keptLines.length > 0 : true) &&
    (dest === 'reply' ? Boolean(inquiryId) : true)
  const label = saveLabel({ dest, kind, ticked: tickedList.length, questionLines: keptLines.length })
  const emptyAnswerOpen = (defaultRfq('answer', ordered) ?? ordered[0])?.open.length ?? 0
  const emptyLabel = emptyAnswerOpen ? `Save answer to ${emptyAnswerOpen} ${emptyAnswerOpen === 1 ? 'question' : 'questions'}` : 'Save'

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
    setError(false)
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
      let answered: number | undefined
      if (dest === 'answer') {
        const ids = tickedList.map(q => q.id)
        const rows = await attachFiles(rfqId, ids[0])
        const at = new Date().toISOString()
        for (const id of ids) await setClarificationAnswer({ id, answer: text || null, answeredAt: at })
        await refresh(rfqId, ['clarification.answer', ...(rows.length ? (['attachment.add'] as const) : [])])
        summary = savedSummary('answer', { questions: ids.length, photos: rows.length })
        answered = ids.length
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
      setResult({ rfq, summary, answered })
      cap.discard()
      toast({
        title: `Saved to ${ref}`,
        body: summary.replace(/\.$/, '').replace(/ and \d+ photos? attached/, ''),
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
    } catch {
      setError(true)
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
      const openQs = clars
        .filter(q => !q.withdrawnAt && !q.answeredAt)
        .map(q => ({ id: q.id, question: q.question, asked: clarState(q) === 'asked', askedAt: q.lastAskedAt, createdAt: q.createdAt }))
      setExtra({ ...c, open: openQs })
    }
  }

  const choose = (d: Dest) => {
    setUserDest(d)
    setTickState(null)
  }
  const toggleTick = (id: string, on: boolean) => {
    if (!rfq) return
    const ids = new Set(ticked)
    if (on) ids.add(id)
    else ids.delete(id)
    setTickState({ rfqId: rfq.id, ids })
  }

  const via = draft.source === 'share' ? { icon: Share2, text: 'Shared from WhatsApp' } : draft.source === 'drop' ? { icon: ClipboardPaste, text: 'Dropped' } : draft.source === 'paste' ? { icon: ClipboardPaste, text: 'Pasted' } : null
  const empty = kind === 'empty' && cap.resizing.length === 0
  const ref = rfq ? rfqRef(rfq.number) : ''
  const shorts = tickedList.map(q => shortQuestion(q.question)).join(', ')

  const body = (
    <>
      {badFiles.map(f => {
        const isImage = f.file.type.startsWith('image/')
        const typeError = !/^[\d.]+ [KM]B/.test(f.error ?? '')
        return (
          <div key={f.id}>
            <Banner tone="danger" icon={FileWarning} title={typeError ? `${f.file.name} can’t be added` : `${f.file.name} is ${sizeOf(f.error ?? '')}. Files can be up to 5 MB.`} className="max-md:hidden">
              {typeError ? f.error : 'Photos are shrunk for you; PDFs are not. Remove it, or add a smaller file. The rest can still be saved.'}
            </Banner>
            <Banner tone="danger" title={typeError ? `${f.file.name} can’t be added` : `${f.file.name} is too large`} className="md:hidden">
              {typeError ? f.error : isImage ? 'Remove it, or take the photo again at a lower quality.' : 'PDFs are not shrunk. Remove it, or scan at a lower quality.'}
            </Banner>
          </div>
        )
      })}
      {!online ? (
        <Banner tone="warning" icon={WifiOff} title="You are offline">
          Your capture is kept on this phone. Save when you are back online.
        </Banner>
      ) : null}
      {error ? (
        <Banner
          tone="danger"
          title="Couldn’t save"
          action={
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              Try again
            </Button>
          }
        >
          Nothing was changed and your capture is still here.
        </Banner>
      ) : null}
    </>
  )

  const left = (
    <div className="grid min-w-0 content-start gap-4">
      <CaptureArea
        text={draft.text}
        files={draft.files.map(f => (f.error && f.file.type.startsWith('image/') ? { ...f, error: `Still ${sizeOf(f.error) || formatBytes(f.file.size)} after resizing. The limit is 5 MB.` } : f))}
        resizing={cap.resizing}
        dragging={cap.dragging}
        autoFocus={draft.source === 'pick'}
        onText={cap.setText}
        onFiles={files => cap.add({ files }, 'pick')}
        onRemove={cap.removeFile}
        count={countsText(draft.source, draft.text, goodFiles.map(f => f.file))}
      />
      {!empty ? (
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            cap.discard()
            setUserDest(null)
            setUserRfqId(null)
            setTickState(null)
          }}
          className="w-fit text-fg-muted"
        >
          Start over
        </Button>
      ) : null}
    </div>
  )

  const right = (
    <div className="grid min-w-0 content-start gap-4">
      <div className={cn('grid gap-2', empty && 'opacity-[0.55]')}>
        <Section title="What should we do with it?">
          <Tiles chosen={dest} kind={kind} off={empty} onChoose={choose} />
        </Section>
        {empty ? <span className="text-xs text-fg-muted">You choose after you add something.</span> : null}
        {!empty ? (
          <button
            type="button"
            onClick={() => choose('reply')}
            aria-pressed={dest === 'reply'}
            className={cn('w-fit rounded text-xs text-fg-muted underline decoration-1 underline-offset-2 hover:text-fg', dest === 'reply' && 'font-medium text-fg no-underline')}
          >
            {dest === 'reply' ? 'Reading it as a supplier’s reply' : 'This is a supplier’s reply'}
          </button>
        ) : null}
      </div>

      {!empty && dest !== 'new-rfq' ? (
        <>
          {ordered.length === 0 && !candidatesQuery.isPending ? <p className="text-sm text-fg-muted">No RFQ opened lately and none of yours has a question waiting. Search all RFQs to choose one.</p> : null}
          <RfqPicker list={ordered} chosenId={rfq?.id ?? null} now={now} onPick={pickRfq} />

          {rfq && dest === 'answer' ? (
            <>
              <CapNote>
                {open.length === 0 ? (
                  <>
                    <b>{ref}</b> has no open questions. Choose another RFQ, or add this to its notes.
                  </>
                ) : kind === 'files' ? (
                  <>
                    Answers {tickedList.length === 1 ? '1 open question' : `${tickedList.length} open questions`} on <b>{ref}</b>: {shorts}. The photo is attached as the reply. Tick another to answer it too.
                  </>
                ) : (
                  <>
                    Answers {tickedList.length === 1 ? '1 open question' : `${tickedList.length} open questions`} on <b>{ref}</b>: {shorts}. Untick any that this does not answer.
                  </>
                )}
              </CapNote>
              {open.length ? <QuestionPick open={open} ticked={ticked} onToggle={toggleTick} /> : null}
            </>
          ) : null}

          {rfq && dest === 'questions' ? (
            <Section title={`Split into ${lines.length} ${lines.length === 1 ? 'question' : 'questions'}`} aside="Tick the ones to keep">
              <SplitRows lines={lines} off={lineOff} onToggle={(l, on) => setLineOff(prev => { const next = new Set(prev); if (on) next.delete(l); else next.add(l); return next })} />
              <CapNote>Each line becomes one question on the RFQ, ready to put to the customer.</CapNote>
            </Section>
          ) : null}

          {rfq && dest === 'notes' ? (
            <CapNote>
              {draft.text.trim() ? (
                <>
                  Added to the notes of <b>{ref}</b> as written, with your name and the time: “{noteStamp(user?.name ?? 'You', new Date())}”.
                </>
              ) : (
                <>The files are kept with {ref}.</>
              )}
            </CapNote>
          ) : null}

          {rfq && dest === 'reply' ? (
            <Section title="Which supplier replied?">
              {inquiryList.length === 0 && !inquiries.isPending ? <p className="text-sm text-fg-muted">No supplier has been asked on this RFQ yet.</p> : null}
              <RadioGroup value={inquiryId ?? ''} onValueChange={setInquiryPick} aria-label="Supplier">
                {inquiryList.map(i => (
                  <Radio key={i.id} value={i.id} label={i.supplierName} help={i.lines.length ? 'Has a reply saved' : undefined} />
                ))}
              </RadioGroup>
              <CapNote>The RFQ opens with the reply read out. Nothing is saved until you accept.</CapNote>
            </Section>
          ) : null}
        </>
      ) : null}

      {!empty && dest === 'new-rfq' ? (
        <Section title="Which company?">
          <div>
            <Combobox
              aria-label="Which company?"
              options={(companies.data ?? []).map(c => ({ value: c.id, label: c.name, meta: [c.role, c.country].filter(Boolean).join(' · ') || undefined }))}
              value={company?.id ?? ''}
              onChange={id => {
                const hit = (companies.data ?? []).find(c => c.id === id)
                setCompany(hit ? { id: hit.id, name: hit.name } : null)
              }}
              onQueryChange={setCompanyText}
              loading={companies.isFetching}
              placeholder="Start typing the company"
            />
          </div>
          <CapNote>Intake opens with this text and the company already filled in. Nothing is saved until you create the RFQ.</CapNote>
        </Section>
      ) : null}
    </div>
  )

  return (
    <RadixDialog.Root open onOpenChange={o => !o && !busy && cap.close()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 grid animate-fade-in place-items-center bg-scrim p-4 max-md:p-0">
          <RadixDialog.Content
            aria-describedby={undefined}
            onKeyDown={onKey}
            onOpenAutoFocus={e => {
              e.preventDefault()
              const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('textarea')
              el?.focus()
            }}
            className="grid max-h-[calc(100dvh-64px)] w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded bg-surface shadow-modal focus:outline-none md:w-[960px] max-md:h-dvh max-md:max-h-none max-md:animate-sheet-in max-md:rounded-none md:animate-rise-6"
          >
            {/* Desktop header: tile, title, one sentence. */}
            <header className="flex items-start gap-3 px-5 pt-5 max-md:hidden">
              <span aria-hidden="true" className="grid size-[36px] shrink-0 place-items-center rounded bg-selected text-fg-2">
                <Icon icon={ClipboardPaste} size="lg" />
              </span>
              <div className="grid min-w-0 flex-1 gap-[2px]">
                <RadixDialog.Title className="text-lg font-semibold tracking-snug">Capture</RadixDialog.Title>
                <p className="text-sm text-fg-muted">Text, photos and files from WhatsApp or anywhere else. Choose where they go.</p>
              </div>
              <RadixDialog.Close asChild>
                <Button variant="quiet" size="sm" icon={X} aria-label="Close" disabled={busy} className="-mr-2 -mt-1 text-fg-muted" />
              </RadixDialog.Close>
            </header>
            {/* Phone header: close, title, where it came from. */}
            <header className="flex items-center gap-3 border-b px-4 py-3 md:hidden">
              <RadixDialog.Close asChild>
                <Button variant="quiet" size="touch" icon={X} aria-label="Close" disabled={busy} className="-ml-2 text-fg-muted" />
              </RadixDialog.Close>
              <h2 className="flex-1 text-lg font-semibold tracking-snug">Capture</h2>
              {via ? (
                <span className="inline-flex items-center gap-[6px] text-xs text-fg-muted">
                  <Icon icon={via.icon} size="sm" />
                  {via.text}
                </span>
              ) : null}
            </header>

            <div data-capture-body className="min-h-0 overflow-y-auto text-sm text-fg-2">
              {cap.notice === 'expired' ? (
                <div className="grid gap-4 p-4 md:p-5">
                  <Banner tone="warning" icon={Clock} title="The shared item is no longer on this phone">
                    Shared items are kept for 7 days. Share it again from WhatsApp, or paste it.
                  </Banner>
                  <Button variant="primary" icon={ClipboardPaste} onClick={cap.openCapture} className="h-touch w-full">
                    Open Capture
                  </Button>
                </div>
              ) : result ? (
                <SavedPanel
                  title={`Saved to ${rfqRef(result.rfq.number)}`}
                  summary={result.answered ? `${result.summary} They now wait on Today to be relayed.` : result.summary}
                  rfq={`${rfqRef(result.rfq.number)} · ${result.rfq.companyName}`}
                  answered={result.answered}
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
                  <Button icon={ClipboardPaste} onClick={() => setResult(null)}>
                    Capture another
                  </Button>
                  <Button variant="quiet" onClick={cap.close}>
                    Done
                  </Button>
                </SavedPanel>
              ) : (
                <>
                  <div className="grid gap-3 px-4 pt-4 empty:hidden md:px-5">{body}</div>
                  <div className="grid gap-5 p-4 md:grid-cols-2 md:gap-0 md:p-0">
                    <div className="md:p-5">{left}</div>
                    <div className="md:border-l md:p-5">{right}</div>
                  </div>
                </>
              )}
            </div>

            {cap.notice === 'expired' || result ? null : (
              <footer className="flex items-center gap-2 border-t bg-surface px-4 py-3 md:rounded-b md:bg-sunken md:px-5">
                <span className="mr-auto hidden items-center gap-[6px] text-xs text-fg-muted md:inline-flex">
                  {empty ? (
                    'Nothing to save yet'
                  ) : (
                    <>
                      <Kbd>⌘</Kbd>
                      <Kbd>↵</Kbd> saves
                    </>
                  )}
                </span>
                <Button data-cancel onClick={cap.close} className="max-md:hidden">
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void save()}
                  disabled={!ready}
                  busy={busy}
                  busyLabel="Saving"
                  icon={dest === 'new-rfq' && !empty ? ArrowRight : undefined}
                  className="max-md:h-touch max-md:flex-1"
                >
                  {empty ? (
                    <>
                      <span className="md:hidden">Add something first</span>
                      <span className="max-md:hidden">{emptyLabel}</span>
                    </>
                  ) : (
                    label
                  )}
                </Button>
              </footer>
            )}
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
