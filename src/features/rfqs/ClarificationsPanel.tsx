import { useMemo, useRef, useState } from 'react'
import { Copy, Send } from 'lucide-react'
import { businessToday, toBusinessDate } from '@/lib/dates'
import { copyToClipboard } from '@/lib/clipboard'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { Panel } from '@/features/companies/CompanyParts'
import type { ClarificationRow, InquiryRow, RfqHeader } from '@/features/rfqs/api'
import { AddQuestions, QuestionRow, WithdrawnRow } from '@/features/rfqs/ClarificationParts'
import { ChasedByNote, ChaseNote, FormattedMessage, RecipientRow, ReplyByField, SubjectRow, TickList } from '@/features/rfqs/ChaseParts'
import { useClarifications, useFileUrls, useRestoreClarificationAsk, useRfqAttachments, useRfqItems, useSetInquiryRelayed, useStampClarificationAsk } from '@/features/rfqs/hooks'
import { useSignature } from '@/features/rfqs/useSignature'
import {
  agoText,
  answersToRelay,
  chaseDue,
  daysBetween,
  customerConfirmBy,
  customerReturnsOn,
  generateCustomerChase,
  groupClarifications,
  relayText,
  type ChaseText,
  type EnquiryVariant,
} from '@/features/rfqs/lib'

/*
 * Questions for the customer (R09; g2-rfq-detail "Questions for the customer", g2-chase-texts "Customer clarification chase").
 * One record per question, captured by paste, stamped by copy actions (DATA_MODEL decision C):
 *
 *   paste        a pasted message splits into one question per line; each can be tagged to the supplier who asked
 *   to ask       "Copy questions for customer" copies the numbered message and stamps the asked times (stamp_clarification_ask)
 *   asked        "Asked x2", days since the last ask; "Copy chase text" is the same message as a reminder and stamps again
 *   answer       text, or "Answered with photo" (a photo alone stamps answered, no text)
 *   relay        "Copy answers" for a supplier copies their answers (a photo-only one reads "see attached photo") and stamps last_relayed_at
 *   withdraw     the question no longer matters; it can be put back
 *
 * FE-2: add questions 1 paste + 1 tap. Copy for the customer 1 tap. Photo answer 2 taps, 0 typed. Typed answer 2 taps + the text.
 * Copy answers for a supplier 1 tap. Withdraw 1 tap. Required fields: the question text, nothing else.
 */

export function ClarificationsPanel({ rfq, inquiries }: { rfq: RfqHeader; inquiries: InquiryRow[] }) {
  const clars = useClarifications(rfq.id)
  const atts = useRfqAttachments(rfq.id)
  const urls = useFileUrls(rfq.id, (atts.data ?? []).map(a => a.path))
  const signature = useSignature()
  const rfqItems = useRfqItems(rfq.id)
  const { toast } = useToast()
  const stamp = useStampClarificationAsk(rfq.id)
  const restore = useRestoreClarificationAsk(rfq.id)
  const relayStamp = useSetInquiryRelayed(rfq.id)
  const [variant, setVariant] = useState<EnquiryVariant>('whatsapp')

  const rows = clars.data ?? []
  const groups = groupClarifications(rows)
  const today = businessToday()
  const nameOf = new Map(inquiries.map(i => [i.id, i.supplierName]))
  const filesFor = (id: string) => (atts.data ?? []).filter(a => a.clarificationId === id)
  const open = groups.toAsk.length + groups.asked.length
  const options = inquiries.map(i => ({ id: i.id, name: i.supplierName }))

  // The copy runs before the stamp, so no mutation is pending yet while it does: a double tap must not stamp twice.
  const inFlight = useRef(false)
  const [copying, setCopying] = useState(false)
  const once = async (run: () => Promise<void>) => {
    if (inFlight.current) return
    inFlight.current = true
    setCopying(true)
    try {
      await run()
    } finally {
      inFlight.current = false
      setCopying(false)
    }
  }

  /** "Copy message and mark chased": the text goes on the clipboard, the questions are stamped, and an Undo toast offers to take it back. */
  const copyAsk = async (group: ClarificationRow[], repeat: boolean, text: string) => {
    if (!(await copyToClipboard(text))) {
      toast({ title: 'Could not copy the text', body: 'Select the text in the message and copy it by hand. The questions were not marked as asked.', tone: 'danger' })
      return
    }
    const before = group.map(c => ({ id: c.id, firstAskedAt: c.firstAskedAt, lastAskedAt: c.lastAskedAt, lastAskedBy: c.lastAskedBy ?? null, askCount: c.askCount }))
    try {
      await stamp.mutateAsync(group.map(c => c.id))
      toast({
        title: repeat ? 'Chase text copied' : 'Questions copied',
        body: `${group.length} ${group.length === 1 ? 'question' : 'questions'} · marked as asked today`,
        tone: 'success',
        undo: {
          onUndo: async () => {
            await restore.mutateAsync(before)
          },
          settledTitle: repeat ? 'Chase text copied' : 'Questions copied',
          settledBody: `${rfqRef(rfq.number)} marked chased`,
          undoneTitle: 'Undone.',
          undoneBody: 'The questions are not marked as asked.',
        },
      })
    } catch (err) {
      toast({ title: 'Copied, but not marked as asked', body: mapPgError(err).message, tone: 'danger' })
    }
  }

  const copyRelay = async (inq: InquiryRow, answered: ClarificationRow[]) => {
    const text = relayText({
      rfqRef: rfqRef(rfq.number),
      contactName: inq.contactName,
      lines: answered.map(c => ({ question: c.question, answer: c.answer, hasPhoto: filesFor(c.id).length > 0 })),
      signature,
    })
    if (!(await copyToClipboard(text))) {
      toast({ title: 'Could not copy the text', body: 'Nothing was marked as told.', tone: 'danger' })
      return
    }
    const before = inq.lastRelayedAt
    try {
      await relayStamp.mutateAsync({ inquiryId: inq.id, at: new Date().toISOString() })
      toast({
        title: 'Answers copied',
        body: `${inq.supplierName} · marked as told`,
        tone: 'success',
        undo: {
          onUndo: async () => {
            await relayStamp.mutateAsync({ inquiryId: inq.id, at: before })
          },
          settledTitle: 'Answers copied',
          undoneTitle: 'Marked as not told',
        },
      })
    } catch (err) {
      toast({ title: 'Copied, but not marked as told', body: mapPgError(err).message, tone: 'danger' })
    }
  }

  const relays = inquiries.map(i => ({ inq: i, answered: answersToRelay(rows, i) })).filter(r => r.answered.length > 0)
  const count = rows.length - groups.withdrawn.length

  return (
    <div data-slot="clarifications">
      <Panel
        title="Questions for the customer"
        meta={clars.isSuccess && count > 0 ? <span className="num">{count} {count === 1 ? 'question' : 'questions'}</span> : undefined}
        actions={
          open > 0 ? (
            <SegmentedControl
              aria-label="Message channel for the customer"
              value={variant}
              onValueChange={v => setVariant(v as EnquiryVariant)}
              options={[
                { value: 'whatsapp', label: 'WhatsApp' },
                { value: 'email', label: 'Email' },
              ]}
            />
          ) : undefined
        }
      >
        {clars.isPending ? (
          <div className="grid gap-2 p-4" aria-busy="true" aria-label="Loading questions">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : clars.isError ? (
          <div className="px-5 py-4 text-sm text-fg-muted">
            <p>Could not load the questions. Nothing was changed.</p>
            <Button className="mt-2" variant="primary" size="sm" onClick={() => void clars.refetch()}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-muted">No questions yet. Ones raised by suppliers, or your own, are listed here and bundled for the customer in one tap.</p>
        ) : (
          <>
            {relays.map(({ inq, answered }) => (
              <div key={inq.id} className="mx-4 mb-3 mt-3 flex flex-wrap items-center gap-2 rounded border border-tone-warning-fg/25 bg-tone-warning-bg px-3 py-2 text-sm">
                <Icon icon={Send} className="text-tone-warning-fg" />
                <span className="min-w-0 flex-1 basis-40">
                  <b className="font-medium">{inq.supplierName}</b> is waiting for <span className="num">{answered.length}</span> {answered.length === 1 ? 'answer' : 'answers'}.
                </span>
                <Button size="sm" icon={Copy} onClick={() => void once(() => copyRelay(inq, answered))} busy={copying || relayStamp.isPending} aria-label={`Copy answers for supplier ${inq.supplierName}`}>
                  Copy answers
                </Button>
              </div>
            ))}

            {groups.toAsk.length > 0 ? (
              <ChaseGroup
                key="to-ask"
                rfq={rfq}
                rows={groups.toAsk}
                repeat={false}
                variant={variant}
                signature={signature}
                items={rfqItems.data}
                today={today}
                header={<StatusBadge dimension="clarification" value="to-ask" />}
                hint={`${groups.toAsk.length} ${groups.toAsk.length === 1 ? 'question' : 'questions'}`}
                copyLabel="Copy questions for customer"
                stamping={copying || stamp.isPending}
                onCopy={(selected, text) => void once(() => copyAsk(selected, false, text))}
              >
                {groups.toAsk.map(c => (
                  <QuestionRow key={c.id} rfqId={rfq.id} c={c} raisedBy={c.raisedByInquiryId ? (nameOf.get(c.raisedByInquiryId) ?? 'a supplier') : null} files={filesFor(c.id)} urls={urls.data} />
                ))}
              </ChaseGroup>
            ) : null}

            {groups.asked.length > 0 ? (
              <ChaseGroup
                rfq={rfq}
                rows={groups.asked}
                repeat
                variant={variant}
                signature={signature}
                items={rfqItems.data}
                today={today}
                header={<StatusBadge dimension="clarification" value="waiting-customer" label={`Asked ×${Math.max(...groups.asked.map(c => c.askCount))}`} />}
                hint={askedHint(groups.asked, today)}
                copyLabel="Copy chase text"
                stamping={copying || stamp.isPending}
                onCopy={(selected, text) => void once(() => copyAsk(selected, true, text))}
                dueNote={chaseDueNote(groups.asked, rfq.dueOn, today)}
              >
                {groups.asked.map(c => (
                  <QuestionRow key={c.id} rfqId={rfq.id} c={c} raisedBy={c.raisedByInquiryId ? (nameOf.get(c.raisedByInquiryId) ?? 'a supplier') : null} files={filesFor(c.id)} urls={urls.data} />
                ))}
              </ChaseGroup>
            ) : null}

            {groups.answered.length > 0 ? (
              <Group
                key="answered"
                header={<StatusBadge dimension="clarification" value="answered" />}
                hint={`${groups.answered.length} ${groups.answered.length === 1 ? 'question' : 'questions'}`}
              >
                {groups.answered.map(c => (
                  <QuestionRow key={c.id} rfqId={rfq.id} c={c} raisedBy={c.raisedByInquiryId ? (nameOf.get(c.raisedByInquiryId) ?? 'a supplier') : null} files={filesFor(c.id)} urls={urls.data} />
                ))}
              </Group>
            ) : null}

            {groups.withdrawn.length > 0 ? (
              <details className="border-t px-0 py-1 text-sm">
                <summary className="cursor-pointer px-4 py-2 text-fg-muted hover:text-fg">
                  Withdrawn (<span className="num">{groups.withdrawn.length}</span>)
                </summary>
                <ul className="divide-y">
                  {groups.withdrawn.map(c => (
                    <WithdrawnRow key={c.id} rfqId={rfq.id} c={c} />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
        {clars.isSuccess ? <AddQuestions rfqId={rfq.id} inquiries={options} /> : null}
      </Panel>
    </div>
  )
}

function askedHint(rows: ClarificationRow[], today: string): string {
  const last = rows.map(c => c.lastAskedAt).filter((x): x is string => Boolean(x)).sort().at(-1)
  const days = last ? daysBetween(toBusinessDate(new Date(last)), today) : 0
  return `${rows.length} ${rows.length === 1 ? 'question' : 'questions'} · last asked ${agoText(days)}`
}

function chaseDueNote(rows: ClarificationRow[], dueOn: string | null, today: string): string | null {
  const last = rows.map(c => c.lastAskedAt).filter((x): x is string => Boolean(x)).sort().at(-1)
  const days = last ? daysBetween(toBusinessDate(new Date(last)), today) : 0
  if (!chaseDue(days, dueOn, today)) return null
  const soon = dueOn ? daysBetween(today, dueOn.slice(0, 10)) <= 3 && dueOn.slice(0, 10) >= today : false
  return `A chase is due: ${days} ${days === 1 ? 'day' : 'days'} since the last ask${soon ? ' and the bid is due within 3 days' : ''}.`
}

/**
 * One group of questions with the same state: a header with its chip, the questions, and for the ones still to ask or
 * waiting, the message (g2-chase-texts "Customer clarification chase"): every open question ticked, "Kindly confirm by"
 * a date the person can change, the recipient, the subject for an email, the text, and one tap to copy and mark it.
 */
function ChaseGroup({
  rfq,
  rows,
  repeat,
  variant,
  signature,
  items,
  today,
  header,
  hint,
  copyLabel,
  stamping,
  onCopy,
  dueNote,
  children,
}: {
  rfq: RfqHeader
  rows: ClarificationRow[]
  repeat: boolean
  variant: EnquiryVariant
  signature: { name: string; company: string; jobTitle?: string | null; phone?: string | null }
  items?: ReadonlyArray<{ id: string; number: number; description: string; brandName: string | null }>
  today: string
  header: React.ReactNode
  hint: string
  copyLabel: string
  stamping: boolean
  onCopy: (selected: ClarificationRow[], text: string) => void
  dueNote?: string | null
  children: React.ReactNode
}) {
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [chosen, setChosen] = useState<string | null>(null)
  const selected = rows.filter(c => !off.has(c.id))
  const lastBy = rows
    .filter(c => c.lastAskedAt)
    .map(c => ({ by: c.lastAskedBy, at: c.lastAskedAt as string }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .at(-1)
  const defaultBy = customerConfirmBy(rfq.dueOn, today)
  const by = chosen ?? defaultBy
  // Everything of the selected questions the text reads: a chase stamped on the same questions (ask count, dates) rewrites it.
  const selectedKey = JSON.stringify(selected.map(c => [c.id, c.question, c.askCount, c.firstAskedAt, c.lastAskedAt, c.rfqItemId]))
  const draft = useMemo(() => {
    if (selected.length === 0) return null
    const firsts = selected.map(c => c.firstAskedAt).filter((x): x is string => Boolean(x)).sort()
    const lasts = selected.map(c => c.lastAskedAt).filter((x): x is string => Boolean(x)).sort()
    const make = (v: EnquiryVariant): ChaseText => generateCustomerChase({
      rfqRef: rfqRef(rfq.number),
      customerRef: rfq.customerRef,
      contactName: rfq.contact?.name ?? null,
      questions: selected.map(c => c.question),
      askCount: repeat ? Math.max(...selected.map(c => c.askCount)) : 0,
      firstAskedOn: firsts[0] ? toBusinessDate(new Date(firsts[0])) : null,
      lastAskedOn: lasts.at(-1) ? toBusinessDate(new Date(lasts.at(-1) as string)) : null,
      dueOn: rfq.dueOn,
      dueTime: rfq.dueTime,
      itemTags: selected.map(c => {
        const it = c.rfqItemId ? items?.find(i => i.id === c.rfqItemId) : undefined
        return it ? { number: it.number, label: `${it.brandName && !it.description.toLowerCase().includes(it.brandName.toLowerCase()) ? `${it.brandName} ` : ''}${it.description}` } : null
      }),
      today,
      signature,
      variant: v,
      confirmByOverride: chosen,
    })
    return { whatsapp: make('whatsapp'), email: make('email') }
    // selected is derived from rows and off; selectedKey carries every field of it the text reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, rfq.number, rfq.customerRef, rfq.contact?.name, rfq.dueOn, rfq.dueTime, today, signature.name, signature.jobTitle, signature.phone, repeat, chosen, items])
  const shown = draft ? draft[variant] : null
  const count = Math.max(0, ...rows.map(c => c.askCount)) + 1
  const returnsOn = customerReturnsOn(today, rfq.dueOn)
  const text = shown ? shown.body : ''
  return (
    <div className="border-t first:border-t-0">
      <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
        {header}
        <span className="text-right text-xs text-fg-muted">{hint}</span>
      </header>
      <div className="divide-y divide-dashed">{children}</div>
      {repeat ? <ChasedByNote byId={lastBy?.by} at={lastBy?.at} className="px-4 pt-2" /> : null}
      <div className="mx-4 mb-3 mt-2 grid overflow-hidden rounded border bg-surface">
        <TickList
          title="Questions in this message"
          rows={rows.map(c => ({ id: c.id, label: c.question, checked: !off.has(c.id) }))}
          onToggle={(id, on) =>
            setOff(o => {
              const n = new Set(o)
              if (on) n.delete(id)
              else n.add(id)
              return n
            })
          }
        />
        <ReplyByField
          label="Kindly confirm by"
          value={by}
          onChange={v => setChosen(v && v !== defaultBy ? v : null)}
          note={`${rfq.dueOn ? 'One working day before the bid is due.' : 'Three working days from today.'} You can change it.`}
        />
        <RecipientRow channel={variant} lead={variant === 'email' ? 'Email to' : 'WhatsApp to'} contact={rfq.contact} />
        {variant === 'email' && shown?.subject ? <SubjectRow subject={shown.subject} /> : null}
        <div className="px-4 py-3">
          {shown ? <FormattedMessage text={text} testId="chase-text" /> : <p className="text-sm text-fg-muted">Tick at least one question to write the message.</p>}
        </div>
        <ChaseNote className="border-t">
          Copying records {repeat ? 'a chase today' : 'the ask today'} (asked ×{count}). {rfqRef(rfq.number)} moves to Waiting and returns on {formatDay(returnsOn)}.
          {dueNote ? ` ${dueNote}` : ''}
        </ChaseNote>
        <div className="flex flex-wrap items-center gap-2 border-t bg-sunken px-4 py-3">
          <Button variant="primary" size="sm" icon={Copy} disabled={!shown} busy={stamping} busyLabel="Marking asked" onClick={() => onCopy(selected, text)}>
            {copyLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** A plain group of questions (answered). */
function Group({ header, hint, children }: { header: React.ReactNode; hint: string; children: React.ReactNode }) {
  return (
    <div className="border-t first:border-t-0">
      <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
        {header}
        <span className="text-right text-xs text-fg-muted">{hint}</span>
      </header>
      <div className="divide-y divide-dashed">{children}</div>
    </div>
  )
}
