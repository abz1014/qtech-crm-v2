import { useId, useMemo, useRef, useState } from 'react'
import { Check, Send } from 'lucide-react'
import { businessToday, toBusinessDate } from '@/lib/dates'
import { copyToClipboard } from '@/lib/clipboard'
import { MessageActions } from '@/ui/MessageActions'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { Panel } from '@/features/companies/CompanyParts'
import type { ClarificationRow, InquiryRow, RfqHeader } from '@/features/rfqs/api'
import { AddQuestions, QuestionRow, WithdrawnRow } from '@/features/rfqs/ClarificationParts'
import { ChannelLink } from '@/ui/ChannelLink'
import { ChasedByNote, ChaseNote, FormattedMessage, MoreToggle, RecipientRow, ReplyByField, SubjectRow, TickList } from '@/features/rfqs/ChaseParts'
import { useClarifications, useFileUrls, useRestoreClarificationAsk, useRfqAttachments, useRfqItems, useSetInquiryRelayed, useStampClarificationAsk } from '@/features/rfqs/hooks'
import { useSignature } from '@/features/rfqs/useSignature'
import { useChannelPreference } from '@/lib/useChannelPreference'
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
  const [variant, setVariant] = useChannelPreference()

  const rows = clars.data ?? []
  const groups = groupClarifications(rows)
  const today = businessToday()
  const nameOf = new Map(inquiries.map(i => [i.id, i.supplierName]))
  const filesFor = (id: string) => (atts.data ?? []).filter(a => a.clarificationId === id)
  const options = inquiries.map(i => ({ id: i.id, name: i.supplierName }))

  // The copy runs before the stamp, so no mutation is pending yet while it does: a double tap must not stamp twice.
  const inFlight = useRef(false)
  const [copying, setCopying] = useState(false)
  // Suppliers whose answers were opened in WhatsApp / email: their banner offers "Mark as told" (opening never marks).
  const [relayOpened, setRelayOpened] = useState<string[]>([])
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
    await markAsk(group, repeat, true)
  }

  /** Stamps the questions as asked, with Undo. `copied`: the copy button did it, else a WhatsApp / email link was opened. */
  const markAsk = async (group: ClarificationRow[], repeat: boolean, copied: boolean) => {
    const done = copied ? (repeat ? 'Chase text copied' : 'Questions copied') : 'Marked as asked'
    const before = group.map(c => ({ id: c.id, firstAskedAt: c.firstAskedAt, lastAskedAt: c.lastAskedAt, lastAskedBy: c.lastAskedBy ?? null, askCount: c.askCount }))
    try {
      await stamp.mutateAsync(group.map(c => c.id))
      toast({
        title: done,
        body: `${group.length} ${group.length === 1 ? 'question' : 'questions'} · marked as asked today`,
        tone: 'success',
        undo: {
          onUndo: async () => {
            await restore.mutateAsync(before)
          },
          settledTitle: done,
          settledBody: `${rfqRef(rfq.number)} marked chased`,
          undoneTitle: 'Undone.',
          undoneBody: 'The questions are not marked as asked.',
        },
      })
    } catch (err) {
      toast({ title: copied ? 'Copied, but not marked as asked' : 'Not marked as asked', body: mapPgError(err).message, tone: 'danger' })
    }
  }

  const relayFor = (inq: InquiryRow, answered: ClarificationRow[]) =>
    relayText({
      rfqRef: rfqRef(rfq.number),
      contactName: inq.contactName,
      lines: answered.map(c => ({ question: c.question, answer: c.answer, hasPhoto: filesFor(c.id).length > 0 })),
      signature,
    })

  const copyRelay = async (inq: InquiryRow, text: string) => {
    if (!(await copyToClipboard(text))) {
      toast({ title: 'Could not copy the text', body: 'Nothing was marked as told.', tone: 'danger' })
      return
    }
    await markRelay(inq, true)
  }

  /** Stamps last_relayed_at, with Undo. `copied`: the copy button did it, else a WhatsApp / email link was opened. */
  const markRelay = async (inq: InquiryRow, copied: boolean) => {
    setRelayOpened(o => o.filter(id => id !== inq.id))
    const before = inq.lastRelayedAt
    try {
      await relayStamp.mutateAsync({ inquiryId: inq.id, at: new Date().toISOString() })
      toast({
        title: copied ? 'Answers copied' : 'Marked as told',
        body: `${inq.supplierName} · marked as told`,
        tone: 'success',
        undo: {
          onUndo: async () => {
            await relayStamp.mutateAsync({ inquiryId: inq.id, at: before })
          },
          settledTitle: copied ? 'Answers copied' : 'Marked as told',
          undoneTitle: 'Marked as not told',
        },
      })
    } catch (err) {
      toast({ title: copied ? 'Copied, but not marked as told' : 'Not marked as told', body: mapPgError(err).message, tone: 'danger' })
    }
  }

  const relays = inquiries.map(i => ({ inq: i, answered: answersToRelay(rows, i) })).filter(r => r.answered.length > 0)
  const count = rows.length - groups.withdrawn.length

  return (
    <div data-slot="clarifications">
      <Panel
        title="Questions for the customer"
        info={<InfoTip label="About questions">A supplier asked something the customer must answer. Copy the questions, then send each supplier the answers.</InfoTip>}
        meta={clars.isSuccess && count > 0 ? <span className="num">{count} {count === 1 ? 'question' : 'questions'}</span> : undefined}
      >
        {clars.isPending ? (
          <div role="status" className="grid gap-2 p-4" aria-busy="true" aria-label="Loading questions">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : clars.isError ? (
          <div className="px-5 py-4 text-sm text-fg-muted">
            <p>Could not load the questions. Nothing was changed.</p>
            <Button className="mt-2" size="sm" onClick={() => void clars.refetch()}>
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
                <span className="min-w-0 flex-1 basis-[10rem]">
                  <b className="font-medium">{inq.supplierName}</b> is waiting for <span className="num">{answered.length}</span> {answered.length === 1 ? 'answer' : 'answers'}.
                </span>
                <MessageActions
                  size="sm"
                  to={{ name: inq.contactName ?? inq.supplierName, phone: inq.contactPhone, email: inq.contactEmail }}
                  text={relayFor(inq, answered)}
                  email={{ subject: `${rfqRef(rfq.number)}: answers to your questions` }}
                  copy={{ label: 'Copy answers', onCopy: () => once(() => copyRelay(inq, relayFor(inq, answered))), busy: copying || relayStamp.isPending, 'aria-label': `Copy answers for supplier ${inq.supplierName}` }}
                  onOpen={() => setRelayOpened(o => (o.includes(inq.id) ? o : [...o, inq.id]))}
                  channel={variant}
                  onChannelChange={setVariant}
                />
                {relayOpened.includes(inq.id) ? (
                  <Button size="sm" icon={Check} busy={copying || relayStamp.isPending} onClick={() => void once(() => markRelay(inq, false))} aria-label={`Mark ${inq.supplierName} as told`}>
                    Mark as told
                  </Button>
                ) : null}
              </div>
            ))}

            {groups.toAsk.length > 0 ? (
              <ChaseGroup
                key="to-ask"
                rfq={rfq}
                rows={groups.toAsk}
                repeat={false}
                variant={variant}
                onVariant={setVariant}
                signature={signature}
                items={rfqItems.data}
                today={today}
                header={`To ask the customer · ${groups.toAsk.length}`}
                copyLabel="Copy questions for customer"
                stamping={copying || stamp.isPending}
                onCopy={(selected, text) => void once(() => copyAsk(selected, false, text))}
                onMark={selected => void once(() => markAsk(selected, false, false))}
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
                onVariant={setVariant}
                signature={signature}
                items={rfqItems.data}
                today={today}
                header={`Waiting on the customer · ${groups.asked.length}`}
                hint={askedHint(groups.asked, today)}
                copyLabel="Copy chase text"
                stamping={copying || stamp.isPending}
                onCopy={(selected, text) => void once(() => copyAsk(selected, true, text))}
                onMark={selected => void once(() => markAsk(selected, true, false))}
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
                header={`Answered · ${groups.answered.length}`}
              >
                {groups.answered.map(c => (
                  <QuestionRow key={c.id} rfqId={rfq.id} c={c} raisedBy={c.raisedByInquiryId ? (nameOf.get(c.raisedByInquiryId) ?? 'a supplier') : null} files={filesFor(c.id)} urls={urls.data} />
                ))}
              </Group>
            ) : null}

            {groups.withdrawn.length > 0 ? (
              <details className="border-t px-0 py-1 text-sm">
                <summary className="cursor-pointer px-4 py-2 text-fg-muted hover:text-fg">
                  Not needed (<span className="num">{groups.withdrawn.length}</span>)
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
  const times = Math.max(...rows.map(c => c.askCount))
  return `Asked ×${times} · last asked ${agoText(days)}`
}

function chaseDueNote(rows: ClarificationRow[], dueOn: string | null, today: string): string | null {
  const last = rows.map(c => c.lastAskedAt).filter((x): x is string => Boolean(x)).sort().at(-1)
  const days = last ? daysBetween(toBusinessDate(new Date(last)), today) : 0
  if (!chaseDue(days, dueOn, today)) return null
  const soon = dueOn ? daysBetween(today, dueOn.slice(0, 10)) <= 3 && dueOn.slice(0, 10) >= today : false
  return `A chase is due: ${days} ${days === 1 ? 'day' : 'days'} since the last ask${soon ? ' and the quotation is due within 3 days' : ''}.`
}

/**
 * One group of questions with the same state: a plain heading with its count, the questions, and for the ones still to ask or
 * waiting, the message (g2-chase-texts "Customer clarification chase"): a short preview of the text, the recipient, and one tap to
 * copy and mark it; under "Show the whole message", every open question ticked, "Kindly confirm by" a date the person can change,
 * the subject for an email and the full text. The channel is the person's remembered one, with the other as a link.
 */
function ChaseGroup({
  rfq,
  rows,
  repeat,
  variant,
  onVariant,
  signature,
  items,
  today,
  header,
  hint,
  copyLabel,
  stamping,
  onCopy,
  onMark,
  dueNote,
  children,
}: {
  rfq: RfqHeader
  rows: ClarificationRow[]
  repeat: boolean
  variant: EnquiryVariant
  onVariant: (v: EnquiryVariant) => void
  signature: { name: string; company: string; jobTitle?: string | null; phone?: string | null }
  items?: ReadonlyArray<{ id: string; number: number; description: string; brandName: string | null }>
  today: string
  /** The group's plain heading with its count ("To ask the customer · 2"): words, not a chip (consistency spec 1.5). */
  header: string
  hint?: string
  copyLabel: string
  stamping: boolean
  onCopy: (selected: ClarificationRow[], text: string) => void
  /** After a WhatsApp / email link was opened: stamp the questions as asked (the separate "Mark asked" tap). */
  onMark: (selected: ClarificationRow[]) => void
  dueNote?: string | null
  children: React.ReactNode
}) {
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [chosen, setChosen] = useState<string | null>(null)
  const [whole, setWhole] = useState(false)
  const [opened, setOpened] = useState(false)
  const wholeId = useId()
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
      <GroupHeading heading={header} hint={hint} />
      <div className="divide-y divide-dashed">{children}</div>
      {repeat ? <ChasedByNote byId={lastBy?.by} at={lastBy?.at} className="px-4 pt-2" /> : null}
      <div className="mx-4 mb-3 mt-2 grid overflow-hidden rounded border bg-surface">
        {/* The questions are listed just above, so the message itself waits under "Show the whole message" (the rail stays short). */}
        {whole ? (
          <div id={wholeId} className="grid">
            <RecipientRow channel={variant} lead={variant === 'email' ? 'Email to' : 'WhatsApp to'} contact={rfq.contact} />
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
              note={`${rfq.dueOn ? 'One working day before the quotation is due.' : 'Three working days from today.'} You can change it.`}
            />
            {variant === 'email' && shown?.subject ? <SubjectRow subject={shown.subject} /> : null}
          </div>
        ) : null}
        {whole ? (
          <div className="px-4 py-3">
            {shown ? <FormattedMessage text={text} testId="chase-text" /> : <p className="text-sm text-fg-muted">Tick at least one question to write the message.</p>}
          </div>
        ) : null}
        {whole ? (
          <ChaseNote className="border-t">
            Copying records {repeat ? 'a chase today' : 'the ask today'} (asked ×{count}). {rfqRef(rfq.number)} moves to Waiting and returns on {formatDay(returnsOn)}.
            {dueNote ? ` ${dueNote}` : ''}
          </ChaseNote>
        ) : null}
        <div className={`grid gap-2 bg-sunken px-4 py-3 ${whole ? 'border-t' : ''}`}>
          {draft ? (
            <div className="flex flex-wrap items-start gap-2">
              <MessageActions
                size="sm"
                to={rfq.contact}
                text={draft.whatsapp.body}
                email={{ subject: draft.email.subject, body: draft.email.body }}
                variant="secondary"
                copy={{ label: copyLabel, onCopy: () => onCopy(selected, text), busy: stamping, busyLabel: 'Marking asked' }}
                onOpen={() => setOpened(true)}
                channel={variant}
                onChannelChange={onVariant}
              />
              {opened ? (
                <Button
                  size="sm"
                  icon={Check}
                  busy={stamping}
                  busyLabel="Marking asked"
                  onClick={() => {
                    setOpened(false)
                    onMark(selected)
                  }}
                >
                  Mark asked
                </Button>
              ) : null}
            </div>
          ) : (
            <Button size="sm" disabled className="w-fit">
              {copyLabel}
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <MoreToggle open={whole} onToggle={() => setWhole(w => !w)} controls={wholeId} />
            <ChannelLink value={variant} onChange={onVariant} />
          </div>
          {dueNote && !whole ? <p className="text-sm text-tone-warning-fg">{dueNote}</p> : null}
        </div>
      </div>
    </div>
  )
}

/** A plain group of questions (answered). */
/** A group's heading: a plain h3 with its count, and an optional muted note on the right. */
function GroupHeading({ heading, hint }: { heading: string; hint?: string }) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pb-1 pt-3">
      <h3 className="text-sm font-semibold text-fg">{heading}</h3>
      {hint ? <span className="text-right text-sm text-fg-muted">{hint}</span> : null}
    </header>
  )
}

/** A plain group of questions (answered). */
function Group({ header, hint, children }: { header: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-t first:border-t-0">
      <GroupHeading heading={header} hint={hint} />
      <div className="divide-y divide-dashed">{children}</div>
    </div>
  )
}
