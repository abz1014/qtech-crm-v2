import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, CircleCheck, Clock, Copy, Info, Pencil, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDay } from '@/lib/formatDay'
import { rfqRef } from '@/lib/refs'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { joinNames, RFQ_REF_PLACEHOLDER } from '@/features/rfqs/lib/intakeModel'
import { draftAge, draftSummary, type IntakeDraft } from '@/features/rfqs/lib/intakeDraftStore'
import type { EnquiryVariant, ReplyBy } from '@/features/rfqs/lib/enquiryDraft'
import { Banner } from '@/ui/Banner'
import { MessageActions } from '@/ui/MessageActions'
import type { ContactChannel } from '@/lib/useChannelPreference'
import { useRfqInquiries } from '@/features/rfqs/hooks'
import { Button } from '@/ui/Button'
import { buttonStyles } from '@/ui/buttonStyles'
import { CARD } from '@/ui/card'
import { ChannelLink } from '@/features/rfqs/ChaseParts'
import { Icon } from '@/ui/Icon'
import { MoreMenu } from '@/ui/MoreMenu'
import { MenuItem } from '@/ui/Popover'

/*
 * The step line, the enquiry card and the "floated" panel of the intake screen (g2-intake-float frames 5 and 6). The
 * "This RFQ" and "Progress" side boxes are gone (round 2, R2-09): they repeated the page, and the step line says where you are.
 */

export type Step = 'build' | 'suppliers' | 'enquiry' | 'floated' | 'saved'

const PRIMARY_LINK = buttonStyles({ variant: 'primary' })
const SECONDARY_LINK = buttonStyles()

/** The words for saving without asking anyone (owner audit N2): what it does, and what it does not. */
export const SAVE_FOR_LATER = "Save as draft"

/** One button of the step bar. */
export interface BarAction {
  label: string
  onClick: () => void
  icon?: LucideIcon
  busy?: boolean
  busyLabel?: string
  disabled?: boolean
  /** A chevron after the label ("Looks right: find suppliers >"). */
  next?: boolean
  /** Desktop look of a secondary action: outlined (Back) by default, or quiet (Save for later). */
  quiet?: boolean
}

/**
 * The sticky "Next step" bar under the steps of New RFQ (Forest .qb-sticky-bar): a white card with the e3 lift. Desktop: it sticks
 * 16 px above the bottom edge with the summary, a warning, then the buttons in one row, the green one last. Phone (owner audit N1):
 * one slim card (about 66 px) that sits in the page after the list, never over it (audit: a sticky bar covered supplier rows at 375):
 * the green button at full width and the rest ("Back", "Save as draft") in a ⋯ menu. The summary is not repeated there, and the
 * warning (with its own one-tap fix) sits just above the bar, in the page.
 */
export function StepBar({ summary, warning, primary, more }: { summary?: ReactNode; warning?: ReactNode; primary?: BarAction; more: readonly BarAction[] }) {
  const phone = useMediaQuery('(max-width: 767px)')
  if (phone) {
    return (
      <>
        {warning ? <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-card text-tone-warning-fg">{warning}</div> : null}
        <div role="region" aria-label="Next step" data-sticky-bar className="flex items-center gap-2 rounded-card border bg-surface p-2 shadow-e1">
          {primary ? (
            <Button
              variant="primary"
              size="touch"
              icon={primary.icon}
              onClick={primary.onClick}
              busy={primary.busy}
              busyLabel={primary.busyLabel}
              disabled={primary.disabled}
              // A long label ("Looks right: find suppliers") wraps to two lines at 320 px instead of being cut off; the bar stays one slim row.
              className="h-auto min-h-touch min-w-0 flex-1 whitespace-normal py-1"
            >
              <span className="line-clamp-2 min-w-0 text-balance text-center leading-tight">{primary.label}</span>
              {primary.next ? <Icon icon={ChevronRight} /> : null}
            </Button>
          ) : null}
          {more.length > 0 ? (
            <MoreMenu touch side="top" label="More options" className={primary ? undefined : 'ml-auto'} menuClassName="w-[min(300px,calc(100vw-48px))]">
              {more.map(a => (
                <MenuItem key={a.label} icon={a.icon} onClick={a.onClick} disabled={a.disabled || a.busy} className="h-auto min-h-touch py-2">
                  <span className="whitespace-normal">{a.busy && a.busyLabel ? a.busyLabel : a.label}</span>
                </MenuItem>
              ))}
            </MoreMenu>
          ) : null}
        </div>
      </>
    )
  }
  return (
    <div
      role="region"
      aria-label="Next step"
      data-sticky-bar
      className="sticky bottom-4 z-sticky flex min-h-row flex-wrap items-center gap-x-4 gap-y-2 rounded-card border bg-surface px-card py-3 shadow-e3"
    >
      {summary ? <p className="m-0 min-w-0 flex-[1_1_14rem] text-base text-fg-2 [overflow-wrap:anywhere]">{summary}</p> : null}
      {warning ? <div className="flex min-w-0 flex-[1_1_14rem] flex-wrap items-center gap-x-2 gap-y-1 text-base font-card text-tone-warning-fg">{warning}</div> : null}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {more.map(a => (
          <Button key={a.label} variant={a.quiet ? 'quiet' : 'secondary'} icon={a.icon} onClick={a.onClick} busy={a.busy} busyLabel={a.busyLabel} disabled={a.disabled}>
            {a.label}
          </Button>
        ))}
        {primary ? (
          <Button variant="primary" icon={primary.icon} onClick={primary.onClick} busy={primary.busy} busyLabel={primary.busyLabel} disabled={primary.disabled}>
            {primary.label}
            {primary.next ? <Icon icon={ChevronRight} /> : null}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

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
  // Forest .qb-banner data-tone="waiting": the info tint, the clock (or the tick when it is already saved), words, then the choices.
  const box = 'flex flex-wrap items-start gap-3 rounded-card bg-tone-info-bg px-card py-4'
  const glyph = (icon: LucideIcon) => <Icon icon={icon} size="lg" className="mt-[2px] shrink-0 text-tone-info-fg" />
  if (existing) {
    return (
      <section aria-label="Your draft" className={box}>
        {glyph(CircleCheck)}
        <div className="grid min-w-[14rem] flex-1 gap-1">
          <h2 className="text-base font-bold text-tone-info-fg">
            Your draft is already saved as <span className="num">{rfqRef(existing.number)}</span>
          </h2>
          <p className="text-base text-fg">{draftSummary(draft)}. It was saved before (in another tab, or by a save whose answer did not arrive), so saving it again would not make a new RFQ.</p>
        </div>
        <div className="flex basis-full flex-wrap gap-2 md:basis-auto md:self-center">
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
      {glyph(Clock)}
      <div className="grid min-w-[14rem] flex-1 gap-1">
        <h2 className="text-base font-bold text-tone-info-fg">You have a draft from {draftAge(draft.savedAt)}</h2>
        <p className="text-base text-fg">
          {draftSummary(draft)}. It is kept on this device until it is saved. Start new discards it.
          {keepsCapture ? ' If you continue it, the message you brought is not added.' : ''}
        </p>
      </div>
      <div className="flex basis-full flex-wrap gap-2 md:basis-auto md:self-center">
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
 * The four steps in one line at every width (UX audit S1 and recommendation 16; R2-09; Forest .qb-steps): a numbered disc per step
 * (done: forest with white figures, now: the pale green disc with the current ring, to come: the deep grey disc) joined by short
 * rules, the current label heavy. Under 640 px only the current step keeps its label beside the discs, so it never wraps; the others
 * keep theirs for a screen reader. The number is drawn from data-n, so a step reads as its name.
 */
export function StepLine({ step }: { step: Step }) {
  const at = STEP_INDEX[step]
  return (
    <ol aria-label={`Step ${at} of 4`} className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-2 p-0 text-base" data-step-line>
      {STEP_LINE.map((label, i) => {
        const n = i + 1
        const state = n < at || (step !== 'build' && step !== 'suppliers' && step !== 'enquiry' && n === 4) ? 'done' : n === at ? 'now' : 'todo'
        return (
          <li key={label} data-step={state} className="flex min-w-0 items-center gap-2 sm:gap-3" aria-current={state === 'now' ? 'step' : undefined}>
            {i > 0 ? <span aria-hidden="true" className="w-3 shrink-0 border-t-2 border-line sm:w-6" /> : null}
            <span
              aria-hidden="true"
              data-n={n}
              className={cn(
                'num grid size-8 shrink-0 place-items-center rounded-pill text-sm font-heavy before:content-[attr(data-n)]',
                state === 'done' ? 'bg-brand-700 text-primary-foreground' : state === 'now' ? 'bg-brand-100 text-brand-700 shadow-current' : 'bg-deep text-fg-2',
              )}
            />
            <span className={cn('min-w-0', state === 'now' ? 'font-heavy text-fg' : state === 'done' ? 'font-card text-fg-2 max-sm:sr-only' : 'font-card text-fg-muted max-sm:sr-only')}>
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
        'type-body flex items-start gap-3 border-l-2 py-1 pl-3 text-fg-2',
        tone === 'info' ? 'border-tone-info-fg' : 'border-tone-warning-fg',
        className,
      )}
    >
      <Icon icon={Info} className={cn('mt-[2px] shrink-0', tone === 'info' ? 'text-tone-info-fg' : 'text-tone-warning-fg')} />
      <p className="m-0 min-w-0 text-pretty">{children}</p>
    </div>
  )
}

/** One line of the text as drawn: "*bold*" markers are not drawn, the words are bold, and a blank "Spec:" is a highlighted blank. */
function PreviewLine({ line }: { line: string }) {
  const blank = /^(\s*Spec:\s)left blank$/.exec(line)
  if (blank) {
    return (
      <>
        {blank[1]}
        <span
          data-spec-blank
          className="ml-1 inline-flex min-h-chip min-w-[12rem] items-center rounded-control border border-dashed border-tone-warning-fg bg-tone-warning-bg px-2 align-middle text-xs leading-none text-tone-warning-fg"
        >
          left blank
        </span>
      </>
    )
  }
  return (
    <>
      {line.split(/(\*[^*\n]+\*)/).map((part, i) =>
        part === `*${RFQ_REF_PLACEHOLDER}*` ? (
          <PendingRef key={i} />
        ) : /^\*[^*\n]+\*$/.test(part) ? (
          <b key={i} className="font-semibold">{part.slice(1, -1)}</b>
        ) : (
          <WithPendingRef key={i} text={part} />
        ),
      )}
    </>
  )
}

/**
 * The RFQ number is given by the database when the RFQ is saved (an identity column, 0007_rfqs.sql), and that save happens in the
 * copy's own tap. Until then the preview says so in words instead of a template-looking "RFQ-####" (owner audit N5); the copied
 * text always carries the real number (fillRfqRef).
 */
function PendingRef() {
  return (
    <span data-rfq-ref-pending className="rounded bg-sunken px-1 text-fg-muted">
      RFQ number added when you copy
    </span>
  )
}

function WithPendingRef({ text }: { text: string }) {
  if (!text.includes(RFQ_REF_PLACEHOLDER)) return <>{text}</>
  return (
    <>
      {text.split(RFQ_REF_PLACEHOLDER).map((bit, i) => (
        <span key={i}>
          {i > 0 ? <PendingRef /> : null}
          {bit}
        </span>
      ))}
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
  /** Buttons in the card's footer. New RFQ puts them in its sticky step bar instead, so they are never below the fold. */
  actions?: ReactNode
  note?: string
  /** The RFQ is already saved: the recipients are fixed here. */
  locked: boolean
}) {
  // The text is shown as drawn (blank specs highlighted); "Edit the text" swaps it for a text area.
  const [editing, setEditing] = useState(false)
  return (
    <section aria-label="The message" data-work className={cn(CARD, 'px-card')}>
      <header className="flex flex-wrap items-start gap-3 border-b py-4">
        <div className="min-w-[12rem] flex-1">
          <h2 className="type-section m-0">
            {variant === 'email' ? 'Email' : 'WhatsApp message'} to <span className="num">{count}</span> {count === 1 ? 'supplier' : 'suppliers'}
          </h2>
          <p className="type-body m-0 mt-1 text-fg-muted">
            {count === 1 ? 'The message for this supplier.' : `One message for all ${count}. Each supplier skips what they cannot offer.`}
          </p>
        </div>
        <ChannelLink value={variant} onChange={v => onVariant(v as EnquiryVariant)} className="self-center" />
      </header>
      <div className="type-body flex flex-wrap items-center gap-2 border-b py-3">
        <span className="text-fg-muted">Send to</span>
        {recipients.map(r => (
          <span key={r.id} data-row-actions="" className="inline-flex items-center gap-1 text-base font-medium">
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
      <div className="grid gap-2 py-4">
        {subject ? (
          <p className="type-body m-0">
            <span className="text-fg-muted">Subject </span>
            <WithPendingRef text={subject} />
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
              className="w-full resize-y rounded-control border border-line-input bg-surface px-3 py-3 text-base leading-6 text-fg transition-colors duration-fast ease-out hover:border-fg focus-visible:border-primary"
            />
          </>
        ) : (
          <div role="group" aria-label="Message text" data-enquiry-preview className="py-1">
            <pre className="m-0 whitespace-pre-wrap break-words font-sans text-base leading-6 text-fg">
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
      {actions || note ? (
        <footer className="flex flex-wrap items-center gap-3 border-t py-3">
          {actions}
          {note ? <span className="type-body ml-auto text-fg-muted">{note}</span> : null}
        </footer>
      ) : null}
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
  // One green button (owner audit N6): Open in WhatsApp for the first supplier whose chat has not been opened yet. Once every chat
  // is opened (or there is none to open), the green moves to Open RFQ.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const next = messages ? asked.find(i => !opened.has(i.id)) : undefined
  return (
    <section aria-label="Asked suppliers" data-work className={cn(CARD, 'grid gap-4 p-card')}>
      <p className="m-0 inline-flex min-h-chip w-fit items-center gap-2 rounded-pill bg-tone-success-bg px-3 text-sm font-bold text-tone-success-fg">
        <Icon icon={CircleCheck} />
        <span className="min-w-0">
          Asked <span className="num">{n}</span> {n === 1 ? 'supplier' : 'suppliers'} on {formatDay(floatedOn)}
        </span>
      </p>
      <h2 className="type-section m-0">
        <span className="num">{refText}</span> is waiting for prices
      </h2>
      {copied ? (
        <p className="type-body m-0 flex items-start gap-2 text-fg-2">
          <Icon icon={Copy} className="mt-[2px] text-fg-muted" />
          <span>The message is on your clipboard. Paste it into {joinNames(names)}.</span>
        </p>
      ) : (
        <div className="grid gap-2">
          <Banner tone="warning" title="The message did not copy">
            The RFQ is marked as asked. Copy the message below, then paste it into {joinNames(names)}.
          </Banner>
          <label htmlFor="floated-text" className="sr-only">
            Message to copy
          </label>
          <textarea id="floated-text" readOnly value={text} rows={10} className="w-full rounded-control border border-line-input bg-sunken px-3 py-3 text-sm leading-6 max-md:text-base" />
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
            <li key={i.id} data-row-actions="" className="grid gap-2 rounded-control border p-3">
              <b className="type-row">{i.supplierName}</b>
              <MessageActions
                size="sm"
                to={{ name: i.contactName ?? i.supplierName, phone: i.contactPhone, email: i.contactEmail }}
                text={messages.whatsapp}
                email={messages.email}
                copy={false}
                variant={next?.id === i.id ? 'primary' : 'secondary'}
                onOpen={() => setOpened(o => new Set(o).add(i.id))}
                channel={channel}
                onChannelChange={onChannelChange}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {replyBy.date || dueOn ? (
        <dl className="type-body m-0 grid gap-2">
          {replyBy.date ? (
            <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-4">
              <dt className="num m-0 font-card">{formatDay(replyBy.date)}</dt>
              <dd className="m-0 text-fg-2">Reply-by date. Any supplier still silent then appears on Today for a follow-up.</dd>
            </div>
          ) : null}
          {dueOn ? (
            <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-4">
              <dt className="num m-0 font-card">{formatDay(dueOn)}</dt>
              <dd className="m-0 text-fg-2">Quotation due. Prices you enter appear on this RFQ with the best one marked.</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {dueOn ? null : <p className="type-body m-0 text-fg-2">No quotation due date was given, so no follow-up is scheduled until one is added.</p>}
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
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Link to={openTo} className={next ? SECONDARY_LINK : PRIMARY_LINK}>
          Open {refText}
        </Link>
        <Button onClick={onAnother}>Start another RFQ</Button>
      </div>
    </section>
  )
}
