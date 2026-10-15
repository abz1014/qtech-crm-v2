import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Circle, CircleCheck, CircleDot, Copy, Info, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDay } from '@/lib/formatDay'
import { rfqRef } from '@/lib/refs'
import { joinNames } from '@/features/rfqs/lib/intakeModel'
import type { EnquiryVariant, ReplyBy } from '@/features/rfqs/lib/enquiryDraft'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { StatusBadge } from '@/ui/StatusBadge'
import { Icon } from '@/ui/Icon'

/*
 * The right-hand column, the enquiry card and the "floated" panel of the intake screen
 * (g2-intake-float frames 5 and 6).
 */

export type Step = 'build' | 'suppliers' | 'enquiry' | 'floated' | 'saved'

const STEP_INDEX: Record<Step, number> = { build: 1, suppliers: 2, enquiry: 3, floated: 4, saved: 4 }

export function SidePanels({
  step,
  number,
  customer,
  itemCount,
  dueOn,
  tickedCount,
  floated,
  floatedOn,
}: {
  step: Step
  number: number | null
  customer: string | null
  itemCount: number
  dueOn: string | null
  tickedCount: number
  floated: boolean
  floatedOn: string | null
}) {
  const at = STEP_INDEX[step]
  const done = (i: number) => i < at || (step === 'floated' && i === 3)
  const steps: { label: string; state: 'done' | 'now' | 'todo'; note?: string }[] = [
    { label: 'Customer', state: customer ? 'done' : at === 1 ? 'now' : 'todo' },
    { label: 'Items', state: itemCount > 0 && at > 1 ? 'done' : at === 1 && customer ? 'now' : 'todo' },
    { label: 'Suppliers', state: done(2) ? 'done' : at === 2 ? 'now' : 'todo', note: at >= 2 && tickedCount > 0 ? String(tickedCount) : undefined },
    { label: 'Enquiry', state: floated ? 'done' : at === 3 ? 'now' : 'todo', note: floated && floatedOn ? formatDay(floatedOn).slice(4) : undefined },
  ]
  return (
    <aside aria-label="This RFQ" className="hidden content-start gap-4 lg:grid">
      <section className="rounded border bg-surface px-4 py-4">
        <h2 className="mb-2 text-base font-semibold">This RFQ</h2>
        <dl className="grid">
          <Row k="Number">{number != null ? <span className="num">{rfqRef(number)}</span> : <span className="text-fg-muted">Given when saved</span>}</Row>
          <Row k="Customer">{customer ?? <span className="text-fg-muted">Not yet</span>}</Row>
          <Row k="Items">{itemCount > 0 ? <><span className="num">{itemCount}</span> {itemCount === 1 ? 'item' : 'items'}</> : <span className="text-fg-muted">Not yet</span>}</Row>
          <Row k="Bid due">{dueOn ? <span className="num">{formatDay(dueOn)}</span> : <span className="text-fg-muted">Optional</span>}</Row>
          <Row k="Sourcing">
            {floated ? (
              <StatusBadge dimension="sourcing" value="awaiting" label={`Floated to ${tickedCount}, awaiting`} />
            ) : (
              <StatusBadge dimension="sourcing" value="not-floated" />
            )}
          </Row>
        </dl>
      </section>
      <section className="rounded border bg-surface px-4 py-4">
        <h2 className="mb-2 text-base font-semibold">Progress</h2>
        <ol className="m-0 grid list-none gap-2 p-0">
          {steps.map(s => (
            <li key={s.label} className={cn('flex items-center gap-3 text-sm', s.state === 'todo' ? 'text-fg-2' : 'text-fg')} aria-current={s.state === 'now' ? 'step' : undefined}>
              <Icon
                icon={s.state === 'done' ? CircleCheck : s.state === 'now' ? CircleDot : Circle}
                size="lg"
                className={s.state === 'todo' ? 'text-fg-muted' : 'text-brand-green'}
              />
              <span className={cn(s.state === 'now' && 'font-medium')}>
                {s.label}
                <span className="sr-only">{s.state === 'done' ? ', done' : s.state === 'now' ? ', in progress' : ', not started'}</span>
              </span>
              {s.note ? <span className="num ml-auto text-xs text-fg-muted">{s.note}</span> : null}
            </li>
          ))}
        </ol>
      </section>
    </aside>
  )
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[98px_minmax(0,1fr)] items-center py-[6px] text-sm">
      <dt className="text-fg-muted">{k}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
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
    <section aria-label="The enquiry" className="overflow-hidden rounded border bg-surface">
      <header className="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-base font-semibold">
            Enquiry to <span className="num">{count}</span> {count === 1 ? 'supplier' : 'suppliers'}
          </h2>
          <p className="m-0 mt-1 text-sm text-fg-muted">
            {count === 1 ? 'The text for this supplier.' : `One text for all ${count}. Each supplier skips what they cannot offer.`}
          </p>
        </div>
        <SegmentedControl
          aria-label="Message channel"
          large
          value={variant}
          onValueChange={v => onVariant(v as EnquiryVariant)}
          options={[
            { value: 'whatsapp', label: 'WhatsApp' },
            { value: 'email', label: 'Email' },
          ]}
        />
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 text-sm">
        <span className="text-fg-muted">Send to</span>
        {recipients.map(r => (
          <span key={r.id} className="inline-flex h-7 items-center gap-1 rounded border border-line-strong bg-surface pl-2 pr-1 text-xs">
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
              Enquiry text
            </label>
            <textarea
              id="enquiry-text"
              value={body}
              onChange={e => onBody(e.target.value)}
              rows={Math.min(Math.max(body.split('\n').length + 1, 10), 26)}
              spellCheck={false}
              className="w-full resize-y rounded border border-line-input bg-surface px-3 py-3 text-sm leading-5 text-fg hover:border-fg-muted focus-visible:border-fg"
            />
          </>
        ) : (
          <div role="group" aria-label="Enquiry text" data-enquiry-preview className="py-1">
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
}) {
  const n = names.length
  return (
    <section aria-label="Floated" className="grid gap-4 rounded border bg-surface p-6">
      <p className="m-0 flex items-center gap-2 text-sm text-tone-success-fg">
        <Icon icon={CircleCheck} />
        Floated to <span className="num">{n}</span> {n === 1 ? 'supplier' : 'suppliers'} on {formatDay(floatedOn)}
      </p>
      <h2 className="m-0 text-xl font-semibold tracking-snug">
        <span className="num">{refText}</span> is out for prices
      </h2>
      {copied ? (
        <p className="m-0 flex items-start gap-2 text-sm text-fg-2">
          <Icon icon={Copy} className="mt-[2px] text-fg-muted" />
          <span>The text is on your clipboard. Paste it into {joinNames(names)}.</span>
        </p>
      ) : (
        <div className="grid gap-2">
          <Banner tone="warning" title="The text did not copy">
            The RFQ is floated. Copy the text below, then paste it into {joinNames(names)}.
          </Banner>
          <label htmlFor="floated-text" className="sr-only">
            Enquiry text to copy
          </label>
          <textarea id="floated-text" readOnly value={text} rows={10} className="w-full rounded border border-line-input bg-sunken px-3 py-3 text-sm leading-5" />
          <div>
            <Button icon={Copy} onClick={onCopyAgain}>
              Copy again
            </Button>
          </div>
        </div>
      )}
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
              <dd className="m-0 text-fg-2">Bid due. Replies you log appear on this RFQ with the lowest price marked.</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {dueOn ? null : <p className="m-0 text-sm text-fg-2">No bid due date was given, so nothing is chased until you add one.</p>}
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
