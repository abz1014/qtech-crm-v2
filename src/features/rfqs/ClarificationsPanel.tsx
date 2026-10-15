import { useState } from 'react'
import { Copy, Eye, EyeOff, Send } from 'lucide-react'
import { businessToday, toBusinessDate } from '@/lib/dates'
import { copyToClipboard } from '@/lib/clipboard'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { Panel } from '@/features/companies/CompanyParts'
import type { ClarificationRow, InquiryRow, RfqHeader } from '@/features/rfqs/api'
import { AddQuestions, QuestionRow, WithdrawnRow } from '@/features/rfqs/ClarificationParts'
import { useClarifications, useFileUrls, useRfqAttachments, useSetInquiryRelayed, useStampClarificationAsk } from '@/features/rfqs/hooks'
import {
  agoText,
  answersToRelay,
  chaseDue,
  daysBetween,
  generateCustomerAsk,
  groupClarifications,
  relayText,
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
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const { toast } = useToast()
  const stamp = useStampClarificationAsk(rfq.id)
  const relayStamp = useSetInquiryRelayed(rfq.id)
  const [variant, setVariant] = useState<EnquiryVariant>('whatsapp')

  const rows = clars.data ?? []
  const groups = groupClarifications(rows)
  const today = businessToday()
  const nameOf = new Map(inquiries.map(i => [i.id, i.supplierName]))
  const filesFor = (id: string) => (atts.data ?? []).filter(a => a.clarificationId === id)
  const open = groups.toAsk.length + groups.asked.length
  const options = inquiries.map(i => ({ id: i.id, name: i.supplierName }))

  const signature = { name: user?.name ?? 'Q-Tech Solutions', company: 'Q-Tech Solutions' }
  const askText = (group: ClarificationRow[], repeat: boolean) => {
    const firsts = group.map(c => c.firstAskedAt).filter((x): x is string => Boolean(x)).sort()
    const ask = generateCustomerAsk({
      variant,
      rfqRef: rfqRef(rfq.number),
      customerRef: rfq.customerRef,
      contactName: rfq.contact?.name ?? null,
      questions: group.map(c => c.question),
      repeat,
      firstAskedDay: firsts[0] ? toBusinessDate(new Date(firsts[0])) : null,
      dueOn: rfq.dueOn,
      today,
      signature,
    })
    return { ask, text: ask.subject ? `Subject: ${ask.subject}\n\n${ask.body}` : ask.body }
  }

  const copyAsk = async (group: ClarificationRow[], repeat: boolean) => {
    const { text } = askText(group, repeat)
    if (!(await copyToClipboard(text))) {
      toast({ title: 'Could not copy the text', body: 'Open Preview text and copy it by hand. The questions were not marked as asked.', tone: 'danger' })
      return
    }
    try {
      await stamp.mutateAsync(group.map(c => c.id))
      toast({ title: repeat ? 'Chase text copied' : 'Questions copied', body: `${group.length} ${group.length === 1 ? 'question' : 'questions'} · marked as asked today`, tone: 'success' })
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
            try {
              await relayStamp.mutateAsync({ inquiryId: inq.id, at: before })
            } catch (err) {
              toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
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
                <Button size="sm" icon={Copy} onClick={() => void copyRelay(inq, answered)} busy={relayStamp.isPending} aria-label={`Copy answers for supplier ${inq.supplierName}`}>
                  Copy answers
                </Button>
              </div>
            ))}

            {groups.toAsk.length > 0 ? (
              <Group
                key="to-ask"
                header={<StatusBadge dimension="clarification" value="to-ask" />}
                hint={`${groups.toAsk.length} ${groups.toAsk.length === 1 ? 'question' : 'questions'}`}
                footer={({ preview }) => (
                  <>
                    <Button variant="primary" size="sm" icon={Copy} busy={stamp.isPending} busyLabel="Marking asked" onClick={() => void copyAsk(groups.toAsk, false)}>
                      Copy questions for customer
                    </Button>
                    {preview}
                  </>
                )}
                preview={askText(groups.toAsk, false).text}
                note={`Copying marks them as asked today. Reply-by ${formatDay(askText(groups.toAsk, false).ask.replyBy)}.`}
              >
                {groups.toAsk.map(c => (
                  <QuestionRow key={c.id} rfqId={rfq.id} c={c} raisedBy={c.raisedByInquiryId ? (nameOf.get(c.raisedByInquiryId) ?? 'a supplier') : null} files={filesFor(c.id)} urls={urls.data} />
                ))}
              </Group>
            ) : null}

            {groups.asked.length > 0 ? (
              <AskedGroup
                rfq={rfq}
                today={today}
                rows={groups.asked}
                stamping={stamp.isPending}
                onCopy={() => void copyAsk(groups.asked, true)}
                preview={askText(groups.asked, true).text}
              >
                {groups.asked.map(c => (
                  <QuestionRow key={c.id} rfqId={rfq.id} c={c} raisedBy={c.raisedByInquiryId ? (nameOf.get(c.raisedByInquiryId) ?? 'a supplier') : null} files={filesFor(c.id)} urls={urls.data} />
                ))}
              </AskedGroup>
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

function AskedGroup({
  rfq,
  today,
  rows,
  stamping,
  onCopy,
  preview,
  children,
}: {
  rfq: RfqHeader
  today: string
  rows: ClarificationRow[]
  stamping: boolean
  onCopy: () => void
  preview: string
  children: React.ReactNode
}) {
  const times = Math.max(...rows.map(c => c.askCount))
  const last = rows.map(c => c.lastAskedAt).filter((x): x is string => Boolean(x)).sort().at(-1)
  const days = last ? daysBetween(toBusinessDate(new Date(last)), today) : 0
  const due = chaseDue(days, rfq.dueOn, today)
  const soon = rfq.dueOn ? daysBetween(today, rfq.dueOn.slice(0, 10)) <= 3 && rfq.dueOn.slice(0, 10) >= today : false
  return (
    <Group
      header={<StatusBadge dimension="clarification" value="waiting-customer" label={`Asked ×${times}`} />}
      hint={`${rows.length} ${rows.length === 1 ? 'question' : 'questions'} · last asked ${agoText(days)}`}
      footer={({ preview: p }) => (
        <>
          <Button size="sm" icon={Copy} busy={stamping} busyLabel="Marking chased" onClick={onCopy}>
            Copy chase text
          </Button>
          {p}
        </>
      )}
      preview={preview}
      note={due ? `A chase is due: ${days} ${days === 1 ? 'day' : 'days'} since the last ask${soon ? ' and the bid is due within 3 days' : ''}.` : 'Copying records another ask today.'}
    >
      {children}
    </Group>
  )
}

/** One group of questions with the same state: a header with its chip, the questions, and an optional footer with the copy action and a text preview. */
function Group({
  header,
  hint,
  children,
  footer,
  preview,
  note,
}: {
  header: React.ReactNode
  hint: string
  children: React.ReactNode
  footer?: (parts: { preview: React.ReactNode }) => React.ReactNode
  preview?: string
  note?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="border-t first:border-t-0">
      <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
        {header}
        <span className="text-right text-xs text-fg-muted">{hint}</span>
      </header>
      <div className="divide-y divide-dashed">{children}</div>
      {footer ? (
        <footer className="grid gap-2 px-4 pb-3 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            {footer({
              preview: (
                <Button size="sm" variant="quiet" icon={show ? EyeOff : Eye} aria-expanded={show} onClick={() => setShow(s => !s)}>
                  {show ? 'Hide text' : 'Preview text'}
                </Button>
              ),
            })}
          </div>
          {show && preview ? <pre className="whitespace-pre-wrap break-words rounded border bg-sunken p-3 font-sans text-sm text-fg-2">{preview}</pre> : null}
          {note ? <p className="text-xs text-fg-muted">{note}</p> : null}
        </footer>
      ) : null}
    </div>
  )
}
