import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Camera, MessageSquareText, Undo2, X } from 'lucide-react'
import { formatDay } from '@/lib/formatDay'
import { toBusinessDate } from '@/lib/dates'
import { intakeFiles } from '@/lib/fileIntake'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Select } from '@/ui/form/Select'
import { TextArea } from '@/ui/form/TextField'
import { useToast } from '@/ui/useToast'
import type { AttachmentRow, ClarificationRow } from '@/features/rfqs/api'
import { AttachmentItem } from '@/features/rfqs/FileBits'
import { useAddClarifications, useSetClarificationAnswer, useSetClarificationWithdrawn, useUploadAttachment, useDeleteAttachment } from '@/features/rfqs/hooks'
import { attachmentPath, RFQ_FILE_ACCEPT, splitQuestions } from '@/features/rfqs/lib'

/*
 * The two interactive parts of the clarifications panel (R09): adding questions by paste, and one question with its
 * answer actions. Entry burden (FE-2): adding is one paste and one tap; a photo answer is two taps and nothing typed
 * ("Answered with photo", then the photo); a typed answer is "Type answer", the text, "Save answer".
 */

export interface InquiryOption {
  id: string
  name: string
}

// ---------------------------------------------------------------- add by paste

export function AddQuestions({ rfqId, inquiries }: { rfqId: string; inquiries: readonly InquiryOption[] }) {
  const { toast } = useToast()
  const add = useAddClarifications(rfqId)
  const [text, setText] = useState('')
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set())
  const [tags, setTags] = useState<Readonly<Record<string, string>>>({})
  // One id per question text until the save succeeds, so a retry after a network failure cannot add the question twice.
  const ids = useRef(new Map<string, string>())
  const labelId = useId()

  const lines = useMemo(() => splitQuestions(text).filter(q => !dropped.has(q)), [text, dropped])
  const idFor = (q: string) => {
    let id = ids.current.get(q)
    if (!id) ids.current.set(q, (id = crypto.randomUUID()))
    return id
  }

  const submit = async () => {
    if (lines.length === 0 || add.isPending) return
    try {
      await add.mutateAsync(lines.map(q => ({ id: idFor(q), question: q, inquiryId: tags[q] || null })))
      toast({ title: lines.length === 1 ? 'Question added' : `${lines.length} questions added`, body: 'Ready to copy for the customer', tone: 'success' })
      ids.current.clear()
      setText('')
      setDropped(new Set())
      setTags({})
    } catch (err) {
      toast({ title: 'Could not add the questions', body: mapPgError(err, { entity: 'question' }).message, tone: 'danger' })
    }
  }

  return (
    <div className="grid gap-3 border-t px-4 py-3">
      <label id={labelId} htmlFor={`${labelId}-in`} className="sr-only">
        Add questions
      </label>
      <TextArea
        id={`${labelId}-in`}
        rows={2}
        value={text}
        placeholder="Paste a question or type one. A pasted message becomes one question per line."
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {lines.length > 0 ? (
        <ol className="grid gap-2" aria-label="Questions to add">
          {lines.map((q, i) => (
            <li key={q} className="grid gap-1 rounded border border-line bg-sunken p-2 text-sm">
              <div className="flex items-start gap-2">
                <span className="num mt-[2px] text-xs text-fg-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 break-words">{q}</span>
                <Button variant="quiet" size="sm" icon={X} aria-label={`Leave out: ${q}`} className="text-fg-muted" onClick={() => setDropped(d => new Set([...d, q]))} />
              </div>
              {inquiries.length > 0 ? (
                <Select
                  aria-label={`Who asked: ${q}`}
                  placeholder="Our question"
                  options={inquiries.map(o => ({ value: o.id, label: `Asked by ${o.name}` }))}
                  value={tags[q] ?? ''}
                  onChange={e => setTags(t => ({ ...t, [q]: e.target.value }))}
                />
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={MessageSquareText} disabled={lines.length === 0} busy={add.isPending} busyLabel="Adding" onClick={() => void submit()}>
          {lines.length > 1 ? `Add ${lines.length} questions` : 'Add question'}
        </Button>
        {lines.length > 0 && inquiries.length > 0 ? <span className="text-sm text-fg-muted">Say which supplier asked, or leave it as our own question.</span> : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- one question

export function QuestionRow({
  rfqId,
  c,
  raisedBy,
  files,
  urls,
}: {
  rfqId: string
  c: ClarificationRow
  raisedBy: string | null
  files: AttachmentRow[]
  urls: Record<string, string> | undefined
}) {
  const { toast } = useToast()
  const setAnswer = useSetClarificationAnswer(rfqId)
  const withdraw = useSetClarificationWithdrawn(rfqId)
  const upload = useUploadAttachment(rfqId)
  const delFile = useDeleteAttachment(rfqId)
  const photoInput = useRef<HTMLInputElement>(null)
  const answerBox = useRef<HTMLTextAreaElement>(null)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [busyPhoto, setBusyPhoto] = useState(false)
  useEffect(() => {
    if (typing) answerBox.current?.focus()
  }, [typing])
  const open = !c.answeredAt && !c.withdrawnAt
  const by = raisedBy ? `Asked by ${raisedBy}` : 'Our question'

  const saveText = async () => {
    const answer = draft.trim()
    if (!answer) return
    try {
      await setAnswer.mutateAsync({ id: c.id, answer, answeredAt: new Date().toISOString() })
      setTyping(false)
      setDraft('')
      toast({
        title: 'Answer saved',
        body: 'Ready to copy for the supplier',
        tone: 'success',
        undo: {
          onUndo: async () => {
            await setAnswer.mutateAsync({ id: c.id, answer: null, answeredAt: null })
          },
          settledTitle: 'Answer saved',
          undoneTitle: 'Answer taken back',
        },
      })
    } catch (err) {
      toast({ title: 'Could not save the answer', body: mapPgError(err, { entity: 'answer' }).message, tone: 'danger' })
    }
  }

  // A photo answers on its own: the file is stored, then the question is stamped answered with no text.
  const onPhoto = async (picked: File[]) => {
    if (picked.length === 0) return
    const [item] = await intakeFiles(picked.slice(0, 1), { accept: RFQ_FILE_ACCEPT })
    if (item.error) {
      toast({ title: 'That photo was not added', body: `${item.file.name}: ${item.error}`, tone: 'danger' })
      return
    }
    setBusyPhoto(true)
    let saved: AttachmentRow | null = null
    try {
      saved = await upload.mutateAsync({ clarificationId: c.id, file: item.file, path: attachmentPath(rfqId, crypto.randomUUID(), item.file.name, item.file.type) })
      await setAnswer.mutateAsync({ id: c.id, answer: null, answeredAt: new Date().toISOString() })
      const photo = saved
      toast({
        title: 'Answered with photo',
        body: 'Ready to copy for the supplier',
        tone: 'success',
        undo: {
          onUndo: async () => {
            await setAnswer.mutateAsync({ id: c.id, answer: null, answeredAt: null })
            await delFile.mutateAsync({ id: photo.id, path: photo.path })
          },
          settledTitle: 'Answered with photo',
          undoneTitle: 'Photo answer taken back',
        },
      })
    } catch (err) {
      if (saved) await delFile.mutateAsync({ id: saved.id, path: saved.path }).catch(() => undefined)
      toast({ title: 'Could not save the photo answer', body: mapPgError(err, { entity: 'file' }).message, tone: 'danger' })
    } finally {
      setBusyPhoto(false)
    }
  }

  const doWithdraw = async () => {
    try {
      await withdraw.mutateAsync({ id: c.id, at: new Date().toISOString() })
      toast({
        title: 'Question withdrawn',
        body: c.question,
        undo: {
          onUndo: async () => {
            await withdraw.mutateAsync({ id: c.id, at: null })
          },
          settledTitle: 'Question withdrawn',
          undoneTitle: 'Question put back',
        },
      })
    } catch (err) {
      toast({ title: 'Could not withdraw the question', body: mapPgError(err).message, tone: 'danger' })
    }
  }

  return (
    <div className="grid gap-1 px-4 py-2 text-sm">
      <p className="break-words text-pretty">{c.question}</p>
      <span className="text-xs text-fg-muted">{by}</span>

      {c.answeredAt ? (
        <div className="mt-1 grid gap-2 rounded-r border-l-2 border-tone-success-fg bg-sunken px-3 py-2">
          <div>
            <span className="block text-xs text-fg-muted">{c.answer ? 'Our answer' : 'Answered with a photo'}</span>
            {c.answer ? <span className="break-words">{c.answer}</span> : null}
          </div>
          {files.map(f => (
            <AttachmentItem key={f.id} rfqId={rfqId} att={f} url={urls?.[f.path]} note="Photo answer" />
          ))}
          <span className="num text-xs text-fg-muted">{formatDay(toBusinessDate(new Date(c.answeredAt)))}</span>
        </div>
      ) : null}

      {open ? (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button size="sm" icon={Camera} busy={busyPhoto} busyLabel="Saving photo" onClick={() => photoInput.current?.click()} aria-label={`Answered with photo: ${c.question}`}>
              Answered with photo
            </Button>
            <Button size="sm" aria-expanded={typing} onClick={() => setTyping(t => !t)} aria-label={`Type answer: ${c.question}`}>
              Type answer
            </Button>
            <Button size="sm" variant="quiet" icon={X} onClick={() => void doWithdraw()} busy={withdraw.isPending} aria-label={`Withdraw: ${c.question}`} className="text-fg-muted">
              Withdraw
            </Button>
            <input
              ref={photoInput}
              type="file"
              accept={RFQ_FILE_ACCEPT.join(',')}
              tabIndex={-1}
              aria-label={`Photo answer for: ${c.question}`}
              className="sr-only"
              onChange={e => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                void onPhoto(files)
              }}
            />
          </div>
          <p className="text-xs text-fg-muted">Pick or take a photo. No text needed.</p>
          {typing ? (
            <div className="mt-1 grid gap-2">
              <TextArea
                aria-label={`Answer to: ${c.question}`}
                rows={3}
                value={draft}
                ref={answerBox}
                placeholder="Your answer, as you would write it to the supplier"
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void saveText()
                  }
                }}
              />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" disabled={!draft.trim()} busy={setAnswer.isPending} busyLabel="Saving" onClick={() => void saveText()}>
                  Save answer
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setTyping(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/** A withdrawn question, with a way back. */
export function WithdrawnRow({ rfqId, c }: { rfqId: string; c: ClarificationRow }) {
  const { toast } = useToast()
  const withdraw = useSetClarificationWithdrawn(rfqId)
  return (
    <li className="flex items-start gap-2 px-4 py-2 text-sm">
      <span className="min-w-0 flex-1 break-words text-fg-muted line-through">{c.question}</span>
      <Button
        size="sm"
        icon={Undo2}
        busy={withdraw.isPending}
        aria-label={`Put back: ${c.question}`}
        onClick={() => void withdraw.mutateAsync({ id: c.id, at: null }).catch(err => toast({ title: 'Could not put it back', body: mapPgError(err).message, tone: 'danger' }))}
      >
        Put back
      </Button>
    </li>
  )
}
