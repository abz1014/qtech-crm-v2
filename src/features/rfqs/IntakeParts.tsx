import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Circle, CircleCheck, CircleDot, Copy, Info, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDay } from '@/lib/formatDay'
import { rfqRef } from '@/lib/refs'
import { joinNames } from '@/features/rfqs/lib/intakeModel'
import { draftAge, draftSummary, type IntakeDraft } from '@/features/rfqs/lib/intakeDraftStore'
import type { EnquiryVariant, ReplyBy } from '@/features/rfqs/lib/enquiryDraft'
import { Banner } from '@/ui/Banner'
import { MessageActions } from '@/ui/MessageActions'
import type { ContactChannel } from '@/lib/useChannelPreference'
import { useRfqInquiries } from '@/features/rfqs/hooks'
import { Button } from '@/ui/Button'
import { ChannelLink } from '@/features/rfqs/ChaseParts'
import { Icon } from '@/ui/Icon'

/*
 * The step line, the enquiry card and the "floated" panel of the intake screen (g2-intake-float frames 5 and 6). The
 * "This RFQ" and "Progress" side boxes are gone (round 2, R2-09): they repeated the page, and the step line says where you are.
 */

export type Step = 'build' | 'suppliers' | 'enquiry' | 'floated' | 'saved'

const PRIMARY_LINK =
  'inline-flex h-control items-center justify-center rounded border border-primary bg-primary px-3 text-sm font-medium leading-none text-primary-foreground transition-colors duration-fast ease-out hover:border-primary-hover hover:bg-primary-hover'

/**
 * The kept New RFQ draft, offered before anything else on every way in (review of ux/rfqs, item 1): Continue your draft, or Start
 * new (which forgets it). Nothing is kept over it until the person answers. A draft whose RFQ turns out to be saved already
 * (another tab, or a save whose answer was lost) offers "Open RFQ-…" instead of Continue (item 2).
 */
export function DraftOffer({
  draft,
  existing,
  checking,
  startLabel,
  keepsCapture,
  onContinue,
  onStartNew,
}: {
  draft: IntakeDraft
  existing: { id: string; number: number } | null
  /** The draft is being checked (already saved? company still on file?): Continue waits for it. */
  checking: boolean
  /** "Start new", "Start new for Punjab Cement", "Start new with the pasted message". */
  startLabel: string
  /** The visit came from Paste or photo: continuing leaves that message where it is. */
  keepsCapture: boolean
  onContinue: () => void
  onStartNew: () => void
}) {
  const box = 'grid gap-3 rounded border border-tone-info-fg/25 bg-tone-info-bg px-4 py-3'
  if (existing) {
    return (
      <section aria-label="Your draft" className={box}>
        <div className="grid gap-[2px]">
          <h2 className="font-semibold">
            Your draft is already saved as <span className="num">{rfqRef(existing.number)}</span>
          </h2>
          <p className="text-fg-2">{draftSummary(draft)}. It was saved before (in another tab, or by a save whose answer did not arrive), so saving it again would not make a new RFQ.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/rfqs/${existing.id}`} className={PRIMARY_LINK}>
            Open {rfqRef(existing.number)}
          </Link>
          <Button onClick={onStartNew}>{startLabel}</Button>
        </div>
      </section>
    )
  }
  return (
    <section aria-label="Your draft" className={box}>
      <div className="grid gap-[2px]">
        <h2 className="font-semibold">You have a draft from {draftAge(draft.savedAt)}</h2>
        <p className="text-fg-2">
          {draftSummary(draft)}. It is kept on this device until you save it or start new; Start new forgets it.
          {keepsCapture ? ' If you continue it, the pasted message stays in Paste or photo.' : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={onContinue} busy={checking} busyLabel="Checking the draft">
          Continue your draft
        </Button>
        <Button onClick={onStartNew}>{startLabel}</Button>
      </div>
    </section>
  )
}

const STEP_INDEX: Record<Step, number> = { build: 1, suppliers: 2, enquiry: 3, floated: 4, saved: 4 }

/** The four steps, in order. */
const STEP_LINE = ['Items', 'Suppliers', 'Message', 'Done'] as const

/**
 * One compact line with the four steps and the current one in bold, at every width, so the person always knows which of the four
 * they are on (UX audit S1 and recommendation 16; R2-09). It wraps rather than scrolling sideways at 320.
 */
export function StepLine({ step }: { step: Step }) {
  const at = STEP_INDEX[step]
  return (
    <ol aria-label={`Step ${at} of 4`} className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0 text-sm" data-step-line>
      {STEP_LINE.map((label, i) => {
        const n = i + 1
        const state = n < at || (step !== 'build' && step !== 'suppliers' && step !== 'enquiry' && n === 4) ? 'done' : n === at ? 'now' : 'todo'
        return (
          <li key={label} className="flex items-center gap-2" aria-current={state === 'now' ? 'step' : undefined}>
            {i > 0 ? <span aria-hidden="true" className="h-px w-3 bg-line-strong" /> : null}
            <span className={cn('inline-flex items-center gap-1', state === 'now' ? 'font-semibold text-fg' : state === 'done' ? 'text-fg-2' : 'text-fg-muted')}>
              <Icon icon={state === 'done' ? CircleCheck : state === 'now' ? CircleDot : Circle} size="sm" className={state === 'todo' ? 'text-fg-muted' : 'text-brand-green'} />
              {label}
              <span className="sr-only">{state === 'done' ? ', done' : state === 'now' ? ', now' : ''}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * The mockup's hint strip (g2-a.css .hint): an info glyph, a bold lead and one sentence, in the warning tint by default
 * or the info tint (`is-info`). Not a Banner: no title line above the text.
 */
export function Hint({ tone = 'warning', children, className }: { tone?: 'warning' | 'info'; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded border px-4 py-3 text-sm text-fg-2',
        tone === 'info' ? 'border-tone-info-fg/25 bg-tone-info-bg' : 'border-tone-warning-fg/25 bg-tone-warning-bg',
        className,
      )}
    >
      <Icon icon={Info} className={cn('mt-[2px] shrink-0', tone === 'info' ? 'text-tone-info-fg' : 'text-tone-warning-fg')} />
      <p className="m-0 min-w-0 text-pretty">{children}</p>
    </div>
  )
}

/** One line of the text as drawn: "*bold*" markers stay visible and muted, and a blank "Spec:" is a highlighted blank. */
function PreviewLine({ line }: { line: string }) {
  const blank = /^(\s*Spec:\s)left blank$/.exec(line)
  if (blank) {
    return (
      <>
        {blank[1]}
        <span
          data-spec-blank
          className="ml-1 inline-block h-[18px] min-w-[190px] rounded-t-[2px] border-b-[1.5px] border-dashed border-tone-warning-fg bg-tone-warning-bg px-[6px] align-[-3px] text-xs leading-[18px] text-tone-warning-fg"
        >
          left blank
        </span>
      </>
    )
  }
  return (
    <>
      {line.split(/(\*[^*\n]+\*)/).map((part, i) =>
        /^\*[^*\n]+\*$/.test(part) ? (
          <span key={i}>
            <span className="text-fg-muted">*</span>
            <b className="font-semibold">{part.slice(1, -1)}</b>
            <span className="text-fg-muted">*</span>
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}

export function EnquiryCard({
  count,
  variant,
  onVariant,
  recipients,
  onRemoveRecipient,
  subject,
  body,
  onBody,
  actions,
  note,
  locked,
}: {
  count: number
  variant: EnquiryVariant
  onVariant: (v: EnquiryVariant) => void
  recipients: { id: string; name: string }[]
  onRemoveRecipient: (id: string) => void
  subject: string | null
  body: string
  onBody: (text: string) => void
  actions: ReactNode
  note: string
  /** The RFQ is already saved: the recipients are fixed here. */
  locked: boolean
}) {
  // The text is shown as drawn (blank specs highlighted); "Edit the text" swaps it for a text area.
  const [editing, setEditing] = useState(false)
  return (
    <section aria-label="The message" className="overflow-hidden rounded border bg-surface">
      <header className="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-base font-semibold">
            {variant === 'email' ? 'Email' : 'WhatsApp message'} to <span className="num">{count}</span> {count === 1 ? 'supplier' : 'suppliers'}
          </h2>
          <p className="m-0 mt-1 text-sm text-fg-muted">
            {count === 1 ? 'The message for this supplier.' : `One message for all ${count}. Each supplier skips what they cannot offer.`}
          </p>
        </div>
        <ChannelLink value={variant} onChange={v => onVariant(v as EnquiryVariant)} className="self-center" />
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 text-sm">
        <span className="text-fg-muted">Send to</span>
        {recipients.map(r => (
          <span key={r.id} className="inline-flex min-h-7 items-center gap-1 rounded border border-line-strong bg-surface pl-2 pr-1 text-xs">
            {r.name}
            {locked ? null : (
              <Button variant="quiet" size="sm" icon={X} aria-label={`Do not send to ${r.name}`} onClick={() => onRemoveRecipient(r.id)} />
            )}
          </span>
        ))}
        <Button variant="quiet" size="sm" icon={Pencil} className="ml-auto" aria-pressed={editing} onClick={() => setEditing(e => !e)}>
          {editing ? 'Done editing' : 'Edit the text'}
        </Button>
      </div>
      <div className="grid gap-2 px-5 py-4">
        {subject ? (
          <p className="m-0 text-sm">
            <span className="text-fg-muted">Subject </span>
            {subject}
          </p>
        ) : null}
        {editing ? (
          <>
            <label htmlFor="enquiry-text" className="sr-only">
              Message text
            </label>
            <textarea
              id="enquiry-text"
              value={body}
              onChange={e => onBody(e.target.value)}
              rows={Math.min(Math.max(body.split('\n').length + 1, 10), 26)}
              spellCheck={false}
              className="w-full resize-y rounded border border-line-input bg-surface px-3 py-3 text-sm leading-5 text-fg hover:border-fg-muted focus-visible:border-fg max-md:text-base max-md:leading-6"
            />
          </>
        ) : (
          <div role="group" aria-label="Message text" data-enquiry-preview className="py-1">
            <pre className="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-[21px] text-fg">
              {body.split('\n').map((line, i, all) => (
                <span key={i}>
                  <PreviewLine line={line} />
                  {i < all.length - 1 ? '\n' : null}
                </span>
              ))}
            </pre>
          </div>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-3 border-t bg-sunken px-5 py-3">
        {actions}
        <span className="ml-auto text-xs text-fg-muted">{note}</span>
      </footer>
    </section>
  )
}

export function FloatedPanel({
  refText,
  openTo,
  floatedOn,
  names,
  replyBy,
  dueOn,
  copied,
  text,
  onCopyAgain,
  unfloated,
  onAnother,
  rfqId,
  messages,
  channel,
  onChannelChange,
}: {
  refText: string
  openTo: string
  floatedOn: string
  names: string[]
  replyBy: ReplyBy
  dueOn: string | null
  copied: boolean
  text: string
  onCopyAgain: () => void
  /** Items with no supplier ticked, as short sentences ("Item 4 has no supplier yet. ..."), with the link that floats the item. */
  unfloated: { key: string; text: ReactNode; action?: { label: string; onClick: () => void; busy: boolean } }[]
  onAnother: () => void
  /** The saved RFQ: its suppliers asked, each with Open in WhatsApp / Open in email. */
  rfqId?: string
  /** The enquiry in both channels, with the RFQ number filled in. */
  messages?: { whatsapp: string; email: { subject: string | null; body: string } }
  channel?: ContactChannel
  onChannelChange?: (c: ContactChannel) => void
}) {
  const n = names.length
  const asked = useRfqInquiries(rfqId).data?.filter(i => i.sentOn) ?? []
  return (
    <section aria-label="Sent to suppliers" className="grid gap-4 rounded border bg-surface p-6">
      <p className="m-0 flex items-center gap-2 text-sm text-tone-success-fg">
        <Icon icon={CircleCheck} />
        Asked <span className="num">{n}</span> {n === 1 ? 'supplier' : 'suppliers'} on {formatDay(floatedOn)}
      </p>
      <h2 className="m-0 text-xl font-semibold tracking-snug">
        <span className="num">{refText}</span> is waiting for prices
      </h2>
      {copied ? (
        <p className="m-0 flex items-start gap-2 text-sm text-fg-2">
          <Icon icon={Copy} className="mt-[2px] text-fg-muted" />
          <span>The message is on your clipboard. Paste it into {joinNames(names)}.</span>
        </p>
      ) : (
        <div className="grid gap-2">
          <Banner tone="warning" title="The message did not copy">
            The RFQ is marked as sent. Copy the message below, then paste it into {joinNames(names)}.
          </Banner>
          <label htmlFor="floated-text" className="sr-only">
            Message to copy
          </label>
          <textarea id="floated-text" readOnly value={text} rows={10} className="w-full rounded border border-line-input bg-sunken px-3 py-3 text-sm leading-5" />
          <div>
            <Button icon={Copy} onClick={onCopyAgain}>
              Copy again
            </Button>
          </div>
        </div>
      )}
      {messages && asked.length > 0 ? (
        <ul aria-label="Send it to each supplier" className="m-0 grid list-none gap-3 p-0" data-slot="send-to-each">
          {asked.map(i => (
            <li key={i.id} className="grid gap-2">
              <b className="text-sm font-medium">{i.supplierName}</b>
              <MessageActions
                size="sm"
                to={{ name: i.contactName ?? i.supplierName, phone: i.contactPhone, email: i.contactEmail }}
                text={messages.whatsapp}
                email={messages.email}
                copy={false}
                channel={channel}
                onChannelChange={onChannelChange}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {replyBy.date || dueOn ? (
        <dl className="m-0 grid gap-2 text-sm">
          {replyBy.date ? (
            <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-4">
              <dt className="num m-0">{formatDay(replyBy.date)}</dt>
              <dd className="m-0 text-fg-2">Reply-by date. Any supplier still silent then appears on Today as a chase.</dd>
            </div>
          ) : null}
          {dueOn ? (
            <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-4">
              <dt className="num m-0">{formatDay(dueOn)}</dt>
              <dd className="m-0 text-fg-2">Quotation due. Prices you enter appear on this RFQ with the best one marked.</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {dueOn ? null : <p className="m-0 text-sm text-fg-2">No quotation due date was given, so nothing is chased until you add one.</p>}
      {unfloated.map(u => (
        <Hint key={u.key} tone="info">
          {u.text}
          {u.action ? (
            <>
              {' '}
              <button
                type="button"
                onClick={u.action.onClick}
                disabled={u.action.busy}
                className="font-medium text-primary underline-offset-2 hover:underline disabled:text-fg-muted"
              >
                {u.action.label}
              </button>
            </>
          ) : null}
        </Hint>
      ))}
      <div className="flex flex-wrap gap-2">
        <Link
          to={openTo}
          className="inline-flex h-control items-center justify-center rounded border border-primary bg-primary px-3 text-sm font-medium leading-none text-primary-foreground transition-colors duration-fast ease-out hover:border-primary-hover hover:bg-primary-hover"
        >
          Open {refText}
        </Link>
        <Button onClick={onAnother}>Start another RFQ</Button>
      </div>
    </section>
  )
}
