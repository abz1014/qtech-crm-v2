import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronRight, CircleCheck, FileText, ImageIcon, Paperclip, Search, Upload } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { rfqRef } from '@/lib/refs'
import { qk } from '@/features/queryKeys'
import { RFQ_FILE_ACCEPT } from '@/features/rfqs/lib/clarifications'
import { searchRfqs, type RfqHit } from '@/features/rfqs/board/api'
import { openedAgo } from '@/lib/capture/recents'
import { formatBytes, type AddedFile } from '@/lib/fileIntake'
import { cn } from '@/lib/utils'
import { TILES } from '@/features/capture/tiles'
import type { Candidate, Dest, PayloadKind } from '@/features/capture/model'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { TextArea, TextField } from '@/ui/form/TextField'
import { FileRow } from '@/ui/form/FileRow'

/*
 * The small pieces of the Capture sheet (g2-capture.html): the capture area, the destination tiles and the RFQ list.
 * They hold no data rules; CaptureSheet and model.ts do.
 */

export function Tiles({
  chosen,
  kind,
  unavailable,
  onChoose,
}: {
  chosen: Dest
  kind: PayloadKind
  /** A reason per destination that cannot be used right now. */
  unavailable: Partial<Record<Dest, string>>
  onChoose: (d: Dest) => void
}) {
  const order: Dest[] = ['answer', 'questions', 'notes', 'new-rfq', 'reply']
  const move = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = order[(i + step + order.length) % order.length]
    onChoose(next)
    ;(e.currentTarget.parentElement?.querySelector(`[data-dest="${next}"]`) as HTMLElement | null)?.focus()
  }
  return (
    <div role="radiogroup" aria-label="What should we do with it?" className="grid grid-cols-2 gap-2">
      {order.map((d, i) => {
        const t = TILES[d]
        const on = chosen === d
        const why = unavailable[d]
        const title = d === 'answer' && kind === 'files' ? 'Answer with photo' : t.title
        const help = d === 'answer' && kind === 'files' ? 'The photo is the reply, no text needed' : why ?? t.help
        return (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={why ? true : undefined}
            data-dest={d}
            tabIndex={on ? 0 : -1}
            onKeyDown={e => move(e, i)}
            onClick={() => !why && onChoose(d)}
            className={cn(
              'relative grid content-start gap-1 rounded border px-3 py-3 text-left text-sm transition-colors duration-fast ease-out',
              on ? 'border-fg bg-sunken' : 'border-line-strong bg-surface hover:border-line-input',
              why && 'cursor-not-allowed text-fg-muted opacity-70 hover:border-line-strong',
              d === 'reply' && 'col-span-2 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3',
            )}
          >
            <Icon icon={t.icon} size="lg" className={cn(on ? 'text-fg' : 'text-fg-2', d === 'reply' && 'row-span-2')} />
            <b className="font-medium text-fg">{title}</b>
            <span className="text-xs text-fg-muted">{help}</span>
            {on ? <span aria-hidden="true" className="absolute right-2 top-2 size-[6px] rounded-round bg-brand-green" /> : null}
          </button>
        )
      })}
    </div>
  )
}

export function CaptureArea({
  text,
  files,
  dragging,
  autoFocus,
  onText,
  onFiles,
  onRemove,
  onDiscard,
  count,
}: {
  text: string
  files: AddedFile[]
  dragging: boolean
  autoFocus: boolean
  onText: (t: string) => void
  onFiles: (files: File[]) => void
  onRemove: (id: string) => void
  onDiscard: () => void
  count: string
}) {
  const photos = useRef<HTMLInputElement>(null)
  const docs = useRef<HTMLInputElement>(null)
  const empty = !text.trim() && files.length === 0
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)
  const onPaste = (e: ClipboardEvent) => {
    const pasted = [...(e.clipboardData?.files ?? [])]
    if (pasted.length) {
      e.preventDefault()
      onFiles(pasted)
    }
  }
  const pick = (ref: React.RefObject<HTMLInputElement>) => (
    <input
      ref={ref}
      type="file"
      multiple
      tabIndex={-1}
      className="sr-only"
      aria-label={ref === photos ? 'Choose photos' : 'Choose files'}
      accept={ref === photos ? 'image/*' : RFQ_FILE_ACCEPT.join(',')}
      onChange={e => {
        const list = [...(e.target.files ?? [])]
        e.target.value = ''
        if (list.length) onFiles(list)
      }}
    />
  )
  const buttons = (
    <div className="grid grid-cols-2 gap-2">
      <Button icon={ImageIcon} onClick={() => photos.current?.click()}>
        Choose photos
      </Button>
      <Button icon={Paperclip} onClick={() => docs.current?.click()}>
        Choose files
      </Button>
      {pick(photos)}
      {pick(docs)}
    </div>
  )
  return (
    <section aria-label="What you captured" className="grid content-start gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-fg">{empty ? 'Add what you copied' : 'What you captured'}</h3>
        {!empty ? <span className="text-xs text-fg-muted">{count}</span> : null}
      </div>

      <div
        className={cn(
          'grid gap-2 rounded border bg-surface transition-colors duration-fast ease-out',
          dragging ? 'border-2 border-dashed border-brand-green' : empty ? 'border-dashed border-line-input bg-sunken' : 'border-line-strong',
        )}
      >
        {dragging ? (
          <p className="grid min-h-[140px] place-items-center px-4 text-center text-sm font-medium text-fg" aria-live="polite">
            Release to add the files
          </p>
        ) : (
          <>
            {empty ? (
              <div className="grid justify-items-center gap-1 px-4 pt-5 text-center text-sm">
                <span className="grid size-[36px] place-items-center rounded border bg-surface text-fg-2">
                  <Icon icon={Upload} size="lg" />
                </span>
                <b className="font-medium text-fg">Drop text, photos or files here</b>
                <span className="inline-flex flex-wrap items-center justify-center gap-1 text-xs text-fg-muted">
                  or press <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
                  <Kbd>V</Kbd> to paste what you copied
                </span>
              </div>
            ) : null}
            <TextArea
              aria-label="Captured text"
              value={text}
              onChange={e => onText(e.target.value)}
              onPaste={onPaste}
              autoFocus={autoFocus && empty}
              rows={empty ? 2 : 5}
              placeholder={empty ? 'Or tap and hold here, then tap Paste' : undefined}
              className={cn('resize-y', empty && 'border-0 bg-transparent text-center')}
            />
          </>
        )}
      </div>

      {files.length > 0 ? (
        <ul className="grid gap-2">
          {files.map(f => (
            <li key={f.id}>
              <FileRow item={f} onRemove={() => onRemove(f.id)} />
            </li>
          ))}
        </ul>
      ) : null}

      {buttons}
      <p className="text-xs text-fg-muted">Photos are resized before saving. Each file can be up to {formatBytes(5 * 1024 * 1024)}.</p>
      {!empty ? (
        <Button variant="quiet" size="sm" onClick={onDiscard} className="w-fit text-fg-muted">
          Start over
        </Button>
      ) : null}
    </section>
  )
}

function Row({ c, on, onPick, hint }: { c: Candidate; on: boolean; onPick: () => void; hint: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn('relative flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-sunken', on && 'bg-selected')}
    >
      {on ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-brand-green" /> : null}
      <span aria-hidden="true" className="grid size-[28px] shrink-0 place-items-center rounded border bg-surface text-fg-muted">
        <Icon icon={FileText} size="sm" />
      </span>
      <span className="grid min-w-0 flex-1">
        <b className="truncate font-medium text-fg">
          <span className="num">{rfqRef(c.number)}</span> · {c.companyName}
        </b>
        <span className="text-xs text-fg-muted">{hint}</span>
      </span>
      <span aria-hidden="true" className={cn('grid size-[18px] shrink-0 place-items-center rounded-round border', on ? 'border-primary' : 'border-line-input')}>
        {on ? <span className="size-[8px] rounded-round bg-primary" /> : null}
      </span>
    </button>
  )
}

const plural = (n: number) => `${n} open ${n === 1 ? 'question' : 'questions'}`

export function RfqPicker({
  list,
  chosenId,
  now,
  onPick,
}: {
  list: readonly Candidate[]
  chosenId: string | null
  now: number
  onPick: (c: Candidate) => Promise<void> | void
}) {
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
    void onPick({ id: h.id, number: h.number, companyName: h.companyName, ownerId: null, openedAt: null, open: [] })
  }
  return (
    <section aria-label="On which RFQ" className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-fg">On which RFQ</h3>
        <span className="text-xs text-fg-muted">Recent, and yours with open questions</span>
      </div>
      <div className="overflow-hidden rounded border border-line-strong bg-surface">
        <div className="flex items-center justify-between border-b bg-sunken px-3 py-1 text-xs font-medium text-fg-muted">
          <span>Recent</span>
          <span>{list.length} {list.length === 1 ? 'RFQ' : 'RFQs'}</span>
        </div>
        <div role="radiogroup" aria-label="RFQ" className="divide-y">
          {list.map(c => (
            <Row key={c.id} c={c} on={c.id === chosenId} onPick={() => void onPick(c)} hint={hint(c)} />
          ))}
        </div>
        {searching ? (
          <div className="grid gap-1 border-t p-2">
            <TextField
              autoFocus
              aria-label="Search RFQs"
              placeholder="RFQ number, customer reference or company"
              value={text}
              onChange={e => setText(e.target.value)}
              prefix={<Icon icon={Search} size="sm" />}
            />
            <ul>
              {(hits.data ?? []).map(h => (
                <li key={h.id}>
                  <button type="button" onClick={() => pickHit(h)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-sunken">
                    <b className="num font-medium">{rfqRef(h.number)}</b>
                    <span className="truncate text-fg-muted">{h.companyName}</span>
                  </button>
                </li>
              ))}
              {hits.isSuccess && (hits.data?.length ?? 0) === 0 ? <li className="px-2 py-2 text-sm text-fg-muted">No RFQ matches.</li> : null}
            </ul>
          </div>
        ) : (
          <button type="button" onClick={() => setSearching(true)} className="flex w-full items-center gap-3 border-t px-3 py-2 text-left text-sm hover:bg-sunken">
            <span aria-hidden="true" className="grid size-[28px] shrink-0 place-items-center rounded border bg-surface text-fg-muted">
              <Icon icon={Search} size="sm" />
            </span>
            <span className="flex-1 font-medium">Search all RFQs</span>
            <Icon icon={ChevronRight} className="text-fg-muted" />
          </button>
        )}
      </div>
    </section>
  )
}

export function SavedPanel({ title, summary, rows, children }: { title: string; summary: string; rows: [string, ReactNode][]; children: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-4 py-4 text-center" role="status">
      <span aria-hidden="true" className="grid size-[44px] place-items-center rounded bg-tone-success-bg text-tone-success-fg">
        <Icon icon={CircleCheck} size="xl" />
      </span>
      <h3 className="text-xl font-semibold tracking-snug text-fg">{title}</h3>
      <p className="max-w-[40ch] text-sm text-fg-2">{summary}</p>
      <dl className="grid w-full max-w-[420px] gap-2 rounded border bg-sunken p-3 text-left text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <dt className="text-fg-muted">{k}</dt>
            <dd className="text-right font-medium text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid w-full max-w-[420px] gap-2">{children}</div>
    </div>
  )
}
