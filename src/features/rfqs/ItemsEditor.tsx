import { useEffect, useState, type RefObject } from 'react'
import { ClipboardPaste, Plus, Scissors, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BrandRef, ParseResult } from '@/features/rfqs/lib/parseItems'
import { parseQtyCell, type DraftItem } from '@/features/rfqs/lib/intakeModel'
import { qtyText } from '@/features/rfqs/lib/enquiryDraft'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'

/*
 * Items (g2-intake-float frames 1 and 3): one paste becomes rows. The paste zone is a real text area (so a phone can
 * paste into it) and the whole page listens for a paste, so on a desktop the person presses Ctrl+V with nothing
 * focused. Each row is editable; quantity starts at 1 when the paste gave none.
 */

export interface PastedBlock {
  result: ParseResult
}

// g2-a.css .sp-r: # 28, Qty 76, Description 1fr, Brand 148, Family 120; the remove control gets its own narrow column.
const GRID = 'md:grid md:grid-cols-[28px_76px_minmax(0,1fr)_148px_120px_28px] md:items-center md:gap-3'

const cell =
  'h-control -mx-2 w-[calc(100%+1rem)] max-w-none min-w-0 rounded border border-line-input bg-surface px-2 text-sm text-fg max-md:text-base md:border-transparent md:bg-transparent ' +
  'placeholder:text-fg-muted hover:border-line-input focus-visible:border-fg focus-visible:bg-surface'

function QtyCell({ item, n, onChange }: { item: DraftItem; n: number; onChange: (patch: Partial<DraftItem>) => void }) {
  // While the cell has focus it shows exactly what is typed; the tidy "2 nos" returns when it loses it.
  const [typing, setTyping] = useState<string | null>(null)
  const shown = item.qty == null ? '' : (qtyText(item.qty, item.unit) ?? String(item.qty))
  return (
    <input
      aria-label={`Quantity of item ${n}`}
      value={typing ?? shown}
      placeholder="1 no"
      autoComplete="off"
      onFocus={e => {
        setTyping(shown)
        e.currentTarget.select()
      }}
      onChange={e => {
        setTyping(e.target.value)
        onChange(parseQtyCell(e.target.value))
      }}
      onBlur={() => setTyping(null)}
      className={cn(cell, 'num')}
    />
  )
}

/** A native select drawn as the mockup's chip or plain text: the visible label sits under an invisible, full-size select. */
function PickCell({
  label,
  value,
  onChange,
  options,
  empty,
  chip,
}: {
  label: string
  value: string | null
  onChange: (v: string | null) => void
  options: { value: string; label: string }[]
  empty: string
  chip?: boolean
}) {
  const chosen = options.find(o => o.value === value)
  return (
    <span className="relative inline-flex min-w-0 max-w-full rounded has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-green">
      <span
        className={cn(
          chip
            ? cn(
                'inline-flex h-[22px] w-fit max-w-full items-center gap-[5px] rounded border px-2 text-xs',
                chosen ? 'border-line-strong bg-surface text-fg-2' : 'border-dashed border-line-strong text-fg-muted',
              )
            : cn('truncate text-xs', chosen ? 'text-fg-2' : 'text-fg-muted'),
        )}
      >
        {chip && chosen ? <Icon icon={Check} size="chip" /> : null}
        <span className="truncate">{chosen ? chosen.label : empty}</span>
      </span>
      <select
        aria-label={label}
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded opacity-0"
      >
        <option value="">{empty}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  )
}

export function PasteZone({
  zoneRef,
  onText,
  filled,
}: {
  zoneRef: RefObject<HTMLTextAreaElement>
  onText: (text: string) => void
  filled: boolean
}) {
  const [draft, setDraft] = useState('')
  return (
    <div
      className={cn(
        'relative grid gap-2 rounded border border-dashed border-line-input bg-surface p-4 text-center transition-colors duration-fast ease-out',
        'focus-within:border-fg-muted',
        filled ? 'justify-items-start text-left' : 'justify-items-center',
      )}
    >
      {filled ? null : <Icon icon={ClipboardPaste} size="lg" className="text-fg-muted" />}
      <label htmlFor="intake-paste" className={cn('text-sm', filled ? 'font-medium' : 'text-fg-2')}>
        {filled ? 'Paste another email or list' : 'Paste the customer’s email or item list'}
      </label>
      <textarea
        id="intake-paste"
        ref={zoneRef}
        rows={filled ? 1 : 3}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onPaste={e => {
          // Parsed straight from the clipboard, so one paste is one action. The page-level listener does the same
          // for a paste made with nothing focused.
          const text = e.clipboardData.getData('text/plain')
          if (!text.trim()) return
          e.preventDefault()
          setDraft('')
          onText(text)
        }}
        onBlur={() => {
          if (draft.trim()) {
            onText(draft)
            setDraft('')
          }
        }}
        placeholder="Click here and paste, or type one item per line"
        className="w-full resize-y rounded border border-line-input bg-surface px-3 py-2 font-mono text-sm leading-5 text-fg placeholder:text-fg-muted hover:border-fg-muted focus-visible:border-fg max-md:text-base max-md:leading-6"
      />
      <p className="text-xs text-fg-muted">
        Press <kbd className="num rounded border border-line-strong bg-sunken px-1">Ctrl</kbd>{' '}
        <kbd className="num rounded border border-line-strong bg-sunken px-1">V</kbd> anywhere on this page. Each line
        becomes an item, with quantity and brand picked out.
      </p>
    </div>
  )
}

export function PastedPanel({ block }: { block: PastedBlock }) {
  const { result } = block
  const found = result.items.length
  return (
    <div className="overflow-hidden rounded border bg-surface">
      <div className="flex items-center gap-2 border-b bg-sunken px-4 py-2 text-xs text-fg-muted">
        <Icon icon={ClipboardPaste} size="sm" />
        <span>
          Pasted just now · <span className="num">{result.lineCount}</span> {result.lineCount === 1 ? 'line' : 'lines'}
        </span>
        <span className="ml-auto inline-flex h-5 items-center gap-[5px] rounded border border-tone-success-fg/25 bg-tone-success-bg px-2 text-xs font-medium text-tone-success-fg">
          <Icon icon={Check} size="chip" />
          {found === 0 ? 'No items found' : `${found} ${found === 1 ? 'item' : 'items'} found`}
        </span>
      </div>
      <pre tabIndex={0} aria-label="What was pasted" className="m-0 max-h-[168px] overflow-auto whitespace-pre-wrap break-words py-2 font-mono text-xs leading-5 text-fg-2">
        {result.lines.map((l, i) => (
          <span key={i} className={cn('block px-4', l.kind === 'skipped' && 'bg-tone-warning-bg')}>
            {l.marker ? <mark className="rounded bg-selected px-[2px] text-fg">{l.marker}</mark> : null}
            {l.marker ? ' ' : ''}
            {l.text}
          </span>
        ))}
      </pre>
    </div>
  )
}

export function ItemRows({
  items,
  brands,
  onChange,
  onRemove,
  onAdd,
  note,
  flagged = [],
  focusKey = null,
}: {
  items: readonly DraftItem[]
  brands: readonly BrandRef[]
  onChange: (key: string, patch: Partial<DraftItem>) => void
  onRemove: (key: string) => void
  onAdd: () => void
  /** The footer line ("4 items found in 6 lines. Edit any cell to fix a split."). */
  note: string
  flagged?: readonly string[]
  /** A row just added: its description takes focus. */
  focusKey?: string | null
}) {
  const brandOptions = brands.filter(b => b.kind === 'brand').map(b => ({ value: b.id, label: b.name }))
  const familyOptions = brands.filter(b => b.kind === 'family').map(b => ({ value: b.id, label: b.name }))
  useEffect(() => {
    if (focusKey) document.getElementById(`item-desc-${focusKey}`)?.focus()
  }, [focusKey])

  return (
    <div className="overflow-hidden rounded border bg-surface">
      {items.length > 0 ? (
        <>
          <div className={cn('hidden min-h-8 border-b bg-sunken px-4 text-xs font-medium text-fg-muted', GRID)} aria-hidden="true">
            <span>#</span>
            <span>Qty</span>
            <span>Description</span>
            <span>Brand</span>
            <span>Family</span>
            <span />
          </div>
          <ol className="m-0 grid list-none p-0">
            {items.map((it, idx) => {
              const n = idx + 1
              return (
                <li
                  key={it.key}
                  className={cn(
                    'group grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b px-4 py-3 last:border-b-0 md:min-h-12 md:py-0',
                    GRID,
                    flagged.includes(it.key) && 'bg-tone-warning-bg',
                  )}
                >
                  <span className="num text-xs text-fg-muted">{n}</span>
                  <div className="min-w-0 pl-2 md:pl-0">
                    <QtyCell item={it} n={n} onChange={patch => onChange(it.key, patch)} />
                  </div>
                  <input
                    id={`item-desc-${it.key}`}
                    aria-label={`Description of item ${n}`}
                    value={it.description}
                    onChange={e => onChange(it.key, { description: e.target.value })}
                    placeholder="What the customer asked for"
                    autoComplete="off"
                    title={it.description}
                    className={cn(cell, 'order-2 col-span-3 truncate md:order-none md:col-span-1')}
                  />
                  <div className="order-3 col-span-3 flex flex-wrap items-center gap-3 md:order-none md:contents">
                    <PickCell
                      chip
                      label={`Brand of item ${n}`}
                      value={it.brandId}
                      onChange={v => onChange(it.key, { brandId: v })}
                      options={brandOptions}
                      empty="no brand"
                    />
                    <PickCell
                      label={`Family of item ${n}`}
                      value={it.familyId}
                      onChange={v => onChange(it.key, { familyId: v })}
                      options={familyOptions}
                      empty="no family"
                    />
                  </div>
                  <Button
                    variant="quiet"
                    size="sm"
                    icon={X}
                    aria-label={`Remove item ${n}`}
                    onClick={() => onRemove(it.key)}
                    className="order-1 justify-self-end md:order-none md:opacity-0 md:transition-opacity md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                  />
                </li>
              )
            })}
          </ol>
        </>
      ) : null}
      <div className="flex items-center gap-3 border-t bg-sunken px-4 py-3 text-xs text-fg-muted">
        <Icon icon={Scissors} size="sm" />
        <span className="min-w-0 text-pretty">{note}</span>
        <Button variant="quiet" size="sm" icon={Plus} className="ml-auto shrink-0" onClick={onAdd}>
          Add item
        </Button>
      </div>
    </div>
  )
}
