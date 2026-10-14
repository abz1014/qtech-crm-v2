import { useEffect, useState, type RefObject } from 'react'
import { ClipboardPaste, Plus, Scissors, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BrandRef, ParseResult } from '@/features/rfqs/lib/parseItems'
import type { DraftItem } from '@/features/rfqs/lib/intakeModel'
import { Button } from '@/ui/Button'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { Icon } from '@/ui/Icon'

/*
 * Items (g2-intake-float frames 1 and 3): one paste becomes rows. The paste zone is a real text area (so a phone can
 * paste into it) and the whole page listens for a paste, so on a desktop the person presses Ctrl+V with nothing
 * focused. Each row is editable; quantity starts at 1 when the paste gave none.
 */

export interface PastedBlock {
  result: ParseResult
}

const GRID = 'md:grid md:grid-cols-[28px_72px_64px_minmax(0,1fr)_32px] md:items-start md:gap-3'

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
        className="w-full resize-y rounded border border-line-input bg-surface px-3 py-2 font-mono text-sm leading-5 text-fg placeholder:text-fg-muted hover:border-fg-muted focus-visible:border-fg"
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
          <div className={cn('hidden border-b bg-sunken px-4 py-2 text-xs font-medium text-fg-muted', GRID)} aria-hidden="true">
            <span>#</span>
            <span>Qty</span>
            <span>Unit</span>
            <span>Description, brand and family</span>
            <span />
          </div>
          <ol className="m-0 grid list-none p-0">
            {items.map((it, idx) => {
              const n = idx + 1
              return (
                <li
                  key={it.key}
                  className={cn(
                    'grid grid-cols-2 gap-2 border-b px-4 py-3 last:border-b-0 md:py-2',
                    GRID,
                    flagged.includes(it.key) && 'bg-tone-warning-bg',
                  )}
                >
                  <span className="num col-span-2 text-xs text-fg-muted md:col-span-1 md:text-sm">{n}</span>
                  <NumberInput
                    aria-label={`Quantity of item ${n}`}
                    value={it.qty}
                    onChange={v => onChange(it.key, { qty: v })}
                    min={0}
                    placeholder="1"
                  />
                  <TextField
                    aria-label={`Unit of item ${n}`}
                    value={it.unit}
                    onChange={e => onChange(it.key, { unit: e.target.value })}
                    placeholder="nos"
                    autoComplete="off"
                  />
                  <TextField
                    id={`item-desc-${it.key}`}
                    aria-label={`Description of item ${n}`}
                    value={it.description}
                    onChange={e => onChange(it.key, { description: e.target.value })}
                    placeholder="What the customer asked for"
                    autoComplete="off"
                    className="col-span-2 md:col-span-1"
                    title={it.description}
                  />
                  <div className="col-span-2 grid grid-cols-2 gap-2 md:col-span-1 md:col-start-4 md:row-start-2">
                    <Select
                      aria-label={`Brand of item ${n}`}
                      value={it.brandId ?? ''}
                      onChange={e => onChange(it.key, { brandId: e.target.value || null })}
                      options={brandOptions}
                      placeholder="No brand"
                    />
                    <Select
                      aria-label={`Family of item ${n}`}
                      value={it.familyId ?? ''}
                      onChange={e => onChange(it.key, { familyId: e.target.value || null })}
                      options={familyOptions}
                      placeholder="No family"
                    />
                  </div>
                  <Button
                    variant="quiet"
                    icon={X}
                    aria-label={`Remove item ${n}`}
                    onClick={() => onRemove(it.key)}
                    className="col-span-2 justify-self-end md:col-span-1"
                  />
                </li>
              )
            })}
          </ol>
        </>
      ) : null}
      <div className="flex items-center gap-3 bg-sunken px-4 py-2 text-xs text-fg-muted">
        <Icon icon={Scissors} size="sm" />
        <span className="min-w-0 text-pretty">{note}</span>
        <Button
          variant="quiet"
          size="sm"
          icon={Plus}
          className="ml-auto shrink-0"
          onClick={onAdd}
        >
          Add item
        </Button>
      </div>
    </div>
  )
}
