import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { ChevronRight, CircleCheck, FileText, ImageIcon, Info, Paperclip, Search, Upload, type LucideIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { orderRef, rfqRef } from '@/lib/refs'
import { qk } from '@/features/queryKeys'
import { RFQ_FILE_ACCEPT } from '@/features/rfqs/lib/clarifications'
import { searchRfqs, type RfqHit } from '@/features/rfqs/board/api'
import { searchOrders, type OrderHit } from '@/features/orders/api'
import { openedAgo } from '@/lib/capture/recents'
import type { AddedFile } from '@/lib/fileIntake'
import { cn } from '@/lib/utils'
import { shortDay, type Candidate, type Dest, type OpenQuestion, type OrderCandidate, type PayloadKind } from '@/features/capture/model'
import { TILES, type TileDest } from '@/features/capture/tiles'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { FileRow } from '@/ui/form/FileRow'
import { TextField } from '@/ui/form/TextField'
import { rovingKeyDown, rovingTabIndex } from '@/ui/roving'

/*
 * The pieces of the Capture sheet, drawn as in docs/design/mockups/g2-capture.html (class names there in brackets):
 * the section with its title and aside [cap-sec], the four destination tiles [act], the capture area [drop, cap-text],
 * the RFQ list [dest, dest-i], the question list [q-pick], the split rows [split-rows], the note [cap-note] and the
 * saved screen [confirm]. They hold no data rules; CaptureSheet and model.ts do.
 */

export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('grid min-w-0 gap-2', className)}>
      <h3 className="flex items-center justify-between gap-2 text-sm font-semibold text-fg">
        {title}
        {aside ? <span className="text-xs font-normal text-fg-muted">{aside}</span> : null}
      </h3>
      {children}
    </section>
  )
}

export function CapNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm leading-snug text-fg-muted [&_b]:font-medium [&_b]:text-fg">
      <Icon icon={Info} size="sm" className="mt-px" />
      <span>{children}</span>
    </p>
  )
}

/**
 * The four destinations as radio tiles. With `only` (R2-11) just the chosen one is drawn, wide, and "Something else" (in the sheet)
 * opens the rest; the arrow keys still step through all four, on the same element, so the focus stays put.
 * `prices` false (an engineer: owner decision 2026-10-22, engineers see no prices) leaves out "A supplier's prices": three tiles.
 */
export function Tiles({ chosen, kind, off, onChoose, only = false, prices = true }: { chosen: Dest; kind: PayloadKind; off: boolean; onChoose: (d: Dest) => void; only?: boolean; prices?: boolean }) {
  const order = (Object.keys(TILES) as TileDest[]).filter(d => prices || d !== 'reply')
  const shown = only ? order.filter(d => d === chosen) : order
  // Nothing ticked (the choice is under "Something else", or nothing is captured yet): the first tile takes the Tab stop.
  const noneOn = off || !order.includes(chosen as TileDest)
  const move = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step || off) return
    e.preventDefault()
    const next = order[(i + step + order.length) % order.length]
    onChoose(next)
    ;(e.currentTarget.parentElement?.querySelector(`[data-dest="${next}"]`) as HTMLElement | null)?.focus()
  }
  return (
    <div role="radiogroup" aria-label="What should we do with it" className={cn('grid gap-2', only ? 'grid-cols-1' : 'grid-cols-2')}>
      {shown.map(d => {
        const i = order.indexOf(d)
        const t = TILES[d]
        const on = !off && chosen === d
        const title = d === 'answer' && kind === 'files' ? 'Answer with photo' : t.title
        const help = d === 'answer' && kind === 'files' ? 'The photo is the reply, no text needed' : t.help
        return (
          <button
            key={only ? 'chosen' : d}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={off}
            data-dest={d}
            tabIndex={on || (noneOn && i === 0) ? 0 : -1}
            onKeyDown={e => move(e, i)}
            onClick={() => onChoose(d)}
            className={cn(
              'relative grid content-start gap-[2px] rounded border p-3 text-left transition-colors duration-fast ease-out',
              only ? 'grid-cols-[auto_minmax(0,1fr)] gap-x-3 pr-8' : 'min-h-[76px]',
              on ? 'border-fg bg-sunken' : 'border-line-strong bg-surface hover:border-line-input hover:bg-sunken',
              off && 'cursor-not-allowed bg-sunken hover:border-line-strong',
            )}
          >
            <Icon icon={t.icon} size="lg" className={cn(only ? 'row-span-2 self-center' : 'mb-1', on ? 'text-fg' : 'text-fg-muted', off && 'text-fg-disabled')} />
            <b className={cn('text-sm font-medium leading-snug', off && 'text-fg-disabled')}>{title}</b>
            <span className="text-pretty text-sm leading-snug text-fg-muted">{help}</span>
            {on ? <span aria-hidden="true" className="absolute right-[10px] top-[10px] size-[8px] rounded-round bg-brand-green" /> : null}
          </button>
        )
      })}
    </div>
  )
}

/** The chosen destination when it is not one of the four tiles (questions from a supplier, an order), drawn like the chosen tile. */
export function ChosenCard({ icon, title, help }: { icon: LucideIcon; title: string; help: string }) {
  return (
    <div className="relative grid grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 gap-y-[2px] rounded border border-fg bg-sunken p-3 pr-8 text-left" data-chosen-dest>
      <Icon icon={icon} size="lg" className="row-span-2 self-center text-fg" />
      <b className="text-sm font-medium leading-snug">{title}</b>
      <span className="text-pretty text-sm leading-snug text-fg-muted">{help}</span>
      <span aria-hidden="true" className="absolute right-[10px] top-[10px] size-[8px] rounded-round bg-brand-green" />
    </div>
  )
}

export function CaptureArea({
  text,
  files,
  resizing,
  dragging,
  autoFocus,
  onText,
  onFiles,
  onRemove,
  count,
}: {
  text: string
  files: AddedFile[]
  resizing: { id: string; name: string }[]
  dragging: number
  autoFocus: boolean
  onText: (t: string) => void
  onFiles: (files: File[]) => void
  onRemove: (id: string) => void
  count: string
}) {
  const photos = useRef<HTMLInputElement>(null)
  const docs = useRef<HTMLInputElement>(null)
  const empty = !text.trim() && files.length === 0 && resizing.length === 0
  // g2-capture frame "Answer with photo": a photo alone shows only its file row, no empty text box. Once there has been text the box stays (deleting the last
  // letter must not take the box, and the cursor, away).
  const hadText = useRef(false)
  if (text.length > 0) hadText.current = true
  const showText = text.length > 0 || hadText.current || (files.length === 0 && resizing.length === 0)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)
  const onPaste = (e: ClipboardEvent) => {
    const pasted = [...(e.clipboardData?.files ?? [])]
    if (pasted.length) {
      e.preventDefault()
      onFiles(pasted)
    }
  }
  const input = (ref: RefObject<HTMLInputElement>, label: string, accept: string) => (
    <input
      ref={ref}
      type="file"
      multiple
      tabIndex={-1}
      className="sr-only"
      aria-label={label}
      accept={accept}
      onChange={e => {
        const list = [...(e.target.files ?? [])]
        e.target.value = ''
        if (list.length) onFiles(list)
      }}
    />
  )
  const pickers = (
    <div className="flex flex-wrap justify-center gap-2 max-md:grid max-md:grid-cols-2">
      <Button size="sm" icon={ImageIcon} onClick={() => photos.current?.click()} className="max-md:h-control">
        Choose photos
      </Button>
      <Button size="sm" icon={Paperclip} onClick={() => docs.current?.click()} className="max-md:h-control">
        Choose files
      </Button>
      {input(photos, 'Choose photos', 'image/*')}
      {input(docs, 'Choose files', RFQ_FILE_ACCEPT.join(','))}
    </div>
  )
  const textArea = (cls: string, placeholder?: string, rows = 4) => (
    <textarea
      aria-label="Pasted text"
      value={text}
      rows={rows}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={e => onText(e.target.value)}
      onPaste={onPaste}
      className={cn('block w-full resize-y whitespace-pre-wrap text-sm leading-5 text-fg placeholder:text-fg-muted max-md:text-base max-md:leading-6', cls)}
    />
  )

  if (dragging > 0) {
    return (
      <div className="grid min-h-[300px] content-center justify-items-center gap-2 rounded-panel border-2 border-dashed border-brand-green bg-surface px-5 py-8 text-center text-sm" aria-live="polite">
        <span className="grid size-[40px] place-items-center rounded bg-selected text-fg-2">
          <Icon icon={Upload} size="lg" />
        </span>
        <b className="font-medium text-fg">{`Release to add ${dragging} ${dragging === 1 ? 'file' : 'files'}`}</b>
      </div>
    )
  }

  if (empty) {
    return (
      <>
        {/* Phone (iPhone Safari has no share target): a zone to paste into. */}
        <Section title="Add what you copied" className="md:hidden">
          <div className="grid gap-2 rounded border-2 border-brand-green bg-surface p-3 text-center text-sm">
            <b className="font-medium text-fg">Tap and hold here, then tap Paste</b>
            {textArea('border-0 bg-transparent p-0 text-center focus:outline-none', 'Text and photos you copied from WhatsApp land here.', 3)}
          </div>
          {pickers}
          <p className="text-xs text-fg-muted">Photos are resized before saving. Each file can be up to 5 MB.</p>
        </Section>
        {/* Desktop: drop, or paste anywhere. */}
        <div className="hidden min-h-[300px] content-center justify-items-center gap-3 rounded-panel border border-dashed border-line-input bg-sunken px-5 py-8 text-center text-sm md:grid">
          <span className="grid size-[40px] place-items-center rounded bg-selected text-fg-2">
            <Icon icon={Upload} size="lg" />
          </span>
          <b className="font-medium text-fg">Drop text, photos or files here</b>
          <span className="text-fg-muted">
            or press <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd> <Kbd>V</Kbd> to paste what you copied in WhatsApp Desktop
          </span>
          {pickers}
        </div>
      </>
    )
  }

  return (
    <Section title="What you added" aside={count}>
      {showText ? textArea('rounded border border-line-input bg-surface p-3', undefined, 5) : null}
      <ul className="grid gap-2">
        {files.map(f => (
          <li key={f.id}>
            <FileRow item={f} onRemove={() => onRemove(f.id)} />
          </li>
        ))}
        {resizing.map(r => (
          <li key={r.id} className="flex items-center gap-3 rounded-row border border-line-strong bg-surface px-3 py-2 text-sm">
            <span aria-hidden="true" className="size-[40px] shrink-0 rounded border bg-selected" />
            <span className="grid min-w-0 flex-1">
              <b className="min-w-0 [overflow-wrap:anywhere] break-all font-medium">{r.name}</b>
              <span className="text-xs text-fg-muted">Resizing</span>
            </span>
            <span role="progressbar" aria-label={`Resizing ${r.name}`} className="h-[6px] w-[64px] overflow-hidden rounded-round bg-selected">
              <span className="block h-full w-2/3 rounded-round bg-brand-green" />
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => docs.current?.click()}
        className="hidden items-center justify-center gap-2 rounded border border-dashed border-line-input bg-sunken px-3 py-3 text-sm text-fg-muted hover:border-fg-muted md:flex"
      >
        <Icon icon={Upload} />
        Drop or paste more. Up to 5 MB each.
      </button>
      {input(docs, 'Add more files', RFQ_FILE_ACCEPT.join(','))}
    </Section>
  )
}

function Row({ c, on, onPick, hint, tabIndex }: { c: Candidate; on: boolean; onPick: () => void; hint: string; tabIndex: 0 | -1 }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      tabIndex={tabIndex}
      onClick={onPick}
      className={cn('relative flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-fast ease-out hover:bg-sunken', on && 'bg-selected')}
    >
      {on ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-brand-green" /> : null}
      <span aria-hidden="true" className="grid size-[32px] shrink-0 place-items-center rounded border bg-surface text-fg-2">
        <Icon icon={FileText} />
      </span>
      <span className="grid min-w-0 flex-1">
        <b className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium leading-snug">
          <span className="num">{rfqRef(c.number)}</span> · {c.companyName}
          {c.city ? ` — ${c.city}` : ''}
        </b>
        <span className="min-w-0 [overflow-wrap:anywhere] text-xs leading-snug text-fg-muted">{hint}</span>
      </span>
      <span aria-hidden="true" className={cn('grid size-[16px] shrink-0 place-items-center rounded-round border', on ? 'border-brand-green bg-brand-green' : 'border-line-input bg-surface')}>
        {on ? <span className="size-[6px] rounded-round bg-surface" /> : null}
      </span>
    </button>
  )
}

const plural = (n: number) => `${n} open ${n === 1 ? 'question' : 'questions'}`

export function RfqPicker({ list, chosenId, now, onPick }: { list: readonly Candidate[]; chosenId: string | null; now: number; onPick: (c: Candidate) => Promise<void> | void }) {
  const [searching, setSearching] = useState(false)
  const [text, setText] = useState('')
  const hits = useQuery({ queryKey: qk.rfqs.search(text), queryFn: () => searchRfqs(text), enabled: searching && text.trim().length > 0, staleTime: 30_000 })
  const hint = (c: Candidate) => {
    const q = c.open.length ? ` · ${plural(c.open.length)}` : ''
    return c.openedAt ? `Opened ${openedAgo(c.openedAt, now)}${q}` : `Yours${q}`
  }
  const pickHit = (h: RfqHit) => {
    setSearching(false)
    setText('')
    void onPick({ id: h.id, number: h.number, companyName: h.companyName, ownerId: null, city: null, openedAt: null, open: [] })
  }
  return (
    <Section title="On which RFQ" aside="Recent, and yours with open questions">
      <div className="overflow-hidden rounded-panel border bg-surface">
        <h4 className="flex items-center justify-between border-b bg-sunken px-3 py-2 text-xs font-semibold text-fg-muted">
          <span>Recent</span>
          <span>
            {list.length} {list.length === 1 ? 'RFQ' : 'RFQs'}
          </span>
        </h4>
        <div role="radiogroup" aria-label="RFQ" className="divide-y" onKeyDown={e => rovingKeyDown(e, { item: '[role=radio]', select: true })}>
          {list.map((c, i) => (
            <Row key={c.id} c={c} on={c.id === chosenId} tabIndex={rovingTabIndex(i, list.findIndex(x => x.id === chosenId))} onPick={() => void onPick(c)} hint={hint(c)} />
          ))}
        </div>
        {searching ? (
          <div className="grid gap-1 border-t p-2">
            <TextField autoFocus aria-label="Search RFQs" placeholder="RFQ number, customer reference or company" value={text} onChange={e => setText(e.target.value)} prefix={<Icon icon={Search} size="sm" />} />
            <ul>
              {(hits.data ?? []).map(h => (
                <li key={h.id}>
                  <button type="button" onClick={() => pickHit(h)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-sunken">
                    <b className="num font-medium">{rfqRef(h.number)}</b>
                    <span className="min-w-0 [overflow-wrap:anywhere] text-fg-muted">{h.companyName}</span>
                  </button>
                </li>
              ))}
              {hits.isSuccess && (hits.data?.length ?? 0) === 0 ? <li className="px-2 py-2 text-sm text-fg-muted">No RFQ matches.</li> : null}
            </ul>
          </div>
        ) : (
          <button type="button" onClick={() => setSearching(true)} className="flex min-h-[52px] w-full items-center gap-3 border-t px-3 py-2 text-left text-sm hover:bg-sunken">
            <span aria-hidden="true" className="grid size-[32px] shrink-0 place-items-center rounded border bg-surface text-fg-2">
              <Icon icon={Search} />
            </span>
            <span className="flex-1 font-medium">Search all RFQs</span>
            <Icon icon={ChevronRight} className="text-fg-muted" />
          </button>
        )}
      </div>
    </Section>
  )
}

/** "On which order": the orders opened lately and a search, in the same list style as the RFQs. */
export function OrderPicker({ list, chosenId, now, includePo, onPick }: { list: readonly OrderCandidate[]; chosenId: string | null; now: number; includePo: boolean; onPick: (c: OrderCandidate) => void }) {
  const [searching, setSearching] = useState(false)
  const [text, setText] = useState('')
  const hits = useQuery({ queryKey: qk.orders.captureSearch(text, includePo), queryFn: () => searchOrders(text, undefined, 8, includePo), enabled: searching && text.trim().length > 0, staleTime: 30_000 })
  const pickHit = (h: OrderHit) => {
    setSearching(false)
    setText('')
    onPick({ id: h.id, number: h.number, companyName: h.companyName, openedAt: null })
  }
  return (
    <Section title="On which order" aside="Recently opened">
      <div className="overflow-hidden rounded-panel border bg-surface">
        <h4 className="flex items-center justify-between border-b bg-sunken px-3 py-2 text-xs font-semibold text-fg-muted">
          <span>Recent</span>
          <span>
            {list.length} {list.length === 1 ? 'order' : 'orders'}
          </span>
        </h4>
        <div role="radiogroup" aria-label="Order" className="divide-y" onKeyDown={e => rovingKeyDown(e, { item: '[role=radio]', select: true })}>
          {list.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.id === chosenId}
              tabIndex={rovingTabIndex(i, list.findIndex(x => x.id === chosenId))}
              onClick={() => onPick(c)}
              className={cn('relative flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-sunken', c.id === chosenId && 'bg-selected')}
            >
              {c.id === chosenId ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-brand-green" /> : null}
              <span aria-hidden="true" className="grid size-[32px] shrink-0 place-items-center rounded border bg-surface text-fg-2">
                <Icon icon={FileText} />
              </span>
              <span className="grid min-w-0 flex-1">
                <b className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium leading-snug">
                  <span className="num">{orderRef(c.number)}</span> · {c.companyName}
                </b>
                <span className="min-w-0 [overflow-wrap:anywhere] text-stamp text-fg-muted">{c.openedAt ? `Opened ${openedAgo(c.openedAt, now)}` : 'Found by search'}</span>
              </span>
              <span aria-hidden="true" className={cn('grid size-[16px] shrink-0 place-items-center rounded-round border', c.id === chosenId ? 'border-brand-green bg-brand-green' : 'border-line-input bg-surface')}>
                {c.id === chosenId ? <span className="size-[6px] rounded-round bg-surface" /> : null}
              </span>
            </button>
          ))}
        </div>
        {searching ? (
          <div className="grid gap-1 border-t p-2">
            <TextField autoFocus aria-label="Search orders" placeholder={includePo ? 'Order number or customer PO' : 'Order number'} value={text} onChange={e => setText(e.target.value)} prefix={<Icon icon={Search} size="sm" />} />
            <ul>
              {(hits.data ?? []).map(h => (
                <li key={h.id}>
                  <button type="button" onClick={() => pickHit(h)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-sunken">
                    <b className="num font-medium">{orderRef(h.number)}</b>
                    <span className="min-w-0 [overflow-wrap:anywhere] text-fg-muted">{h.companyName}</span>
                  </button>
                </li>
              ))}
              {hits.isSuccess && (hits.data?.length ?? 0) === 0 ? <li className="px-2 py-2 text-sm text-fg-muted">No order matches.</li> : null}
            </ul>
          </div>
        ) : (
          <button type="button" onClick={() => setSearching(true)} className="flex min-h-[52px] w-full items-center gap-3 border-t px-3 py-2 text-left text-sm hover:bg-sunken">
            <span aria-hidden="true" className="grid size-[32px] shrink-0 place-items-center rounded border bg-surface text-fg-2">
              <Icon icon={Search} />
            </span>
            <span className="flex-1 font-medium">Search all orders</span>
            <Icon icon={ChevronRight} className="text-fg-muted" />
          </button>
        )}
      </div>
    </Section>
  )
}

/** The open questions of the chosen RFQ, ticked [q-pick]: the question and when it was asked. */
export function QuestionPick({ open, ticked, onToggle }: { open: readonly OpenQuestion[]; ticked: ReadonlySet<string>; onToggle: (id: string, on: boolean) => void }) {
  return (
    <ul className="grid overflow-hidden rounded-panel border bg-surface" aria-label="Open questions">
      {open.map(q => (
        <li key={q.id} className={cn('border-t first:border-t-0', ticked.has(q.id) && 'bg-selected')}>
          <label className="grid cursor-pointer grid-cols-[16px_1fr] gap-3 p-3 text-sm leading-5 hover:bg-sunken">
            <input type="checkbox" checked={ticked.has(q.id)} onChange={e => onToggle(q.id, e.target.checked)} className="mt-[2px] size-[16px] accent-[var(--brand-green)]" />
            <span>
              {q.question}
              <small className="block text-xs leading-snug text-fg-muted">{q.askedAt ? `Asked ${shortDay(q.askedAt)}` : 'Not asked yet'}</small>
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
}

/** One line per question, numbered, with a tick [split-rows]. */
export function SplitRows({ lines, off, onToggle }: { lines: readonly string[]; off: ReadonlySet<string>; onToggle: (line: string, on: boolean) => void }) {
  return (
    <ul className="grid overflow-hidden rounded-panel border bg-surface" aria-label="Questions to add">
      {lines.map((l, i) => (
        <li key={l} className="border-t first:border-t-0">
          <label className={cn('grid cursor-pointer grid-cols-[16px_22px_minmax(0,1fr)] items-start gap-2 px-3 py-2 text-sm leading-5', off.has(l) && 'text-fg-muted line-through')}>
            <input type="checkbox" checked={!off.has(l)} onChange={e => onToggle(l, e.target.checked)} aria-label={l} className="mt-[2px] size-[16px] accent-[var(--brand-green)]" />
            <span aria-hidden="true" className="num text-xs leading-5 text-fg-muted">
              {i + 1}
            </span>
            <span>{l}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}

/** "Saved to RFQ-0177" [confirm]. */
export function SavedPanel({
  title,
  summary,
  rfq,
  rfqLabel = 'RFQ',
  answered,
  children,
}: {
  title: string
  summary: string
  rfq: string
  rfqLabel?: string
  answered?: number
  children: ReactNode
}) {
  return (
    <div className="grid justify-items-center gap-3 px-5 pb-4 pt-10 text-center" role="status">
      <span aria-hidden="true" className="grid size-[48px] place-items-center rounded bg-tone-success-bg text-tone-success-fg">
        <Icon icon={CircleCheck} size="xl" />
      </span>
      <h2 className="text-xl font-semibold tracking-snug text-fg">{title}</h2>
      <p className="max-w-[34ch] text-pretty text-sm text-fg-muted">{summary}</p>
      <dl className="grid w-full max-w-[420px] gap-2 rounded-row border bg-surface px-4 py-3 text-left text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">{rfqLabel}</dt>
          <dd className="min-w-0 text-right">{rfq}</dd>
        </div>
      </dl>
      {answered !== undefined ? (
        // One sentence instead of two status chips (round 2, 1.5 "Paste or photo summary").
        <p className="w-full max-w-[420px] text-pretty text-left text-sm text-fg-2" data-answered-next>
          Marks <span className="num">{answered}</span> {answered === 1 ? 'question' : 'questions'} answered. Next: send the {answered === 1 ? 'answer' : 'answers'} to the suppliers.
        </p>
      ) : null}
      <div className="grid w-full max-w-[420px] gap-2 [&>button]:h-touch">{children}</div>
    </div>
  )
}
