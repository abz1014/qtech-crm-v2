import { useEffect, useState, type RefObject } from 'react'
import { ClipboardPaste, Plus, Scissors, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { pastedPictures } from '@/features/rfqs/lib/readPdf'
import type { BrandRef, ParseResult } from '@/features/rfqs/lib/parseItems'
import { parseQtyCell, qtyProblem, type DraftItem } from '@/features/rfqs/lib/intakeModel'
import { qtyText } from '@/features/rfqs/lib/enquiryDraft'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'

/*
 * Items (g2-intake-float frames 1 and 3): one paste becomes rows. The paste zone is a real text area (so a phone can
 * paste into it) and the whole page listens for a paste, so on a desktop the person presses Ctrl+V with nothing
 * focused. A phone has no Ctrl+V: it gets a Paste button instead (the clipboard read where the browser allows it, else
 * "tap and hold in the box, then Paste"). A pasted screenshot is read like a chosen one. Each row is editable; quantity
 * starts at 1 when the paste gave none.
 */


export interface PastedBlock {
  result: ParseResult
}

// g2-a.css .sp-r: # 28, Qty 76, Description 1fr, Brand 148, Family 120; the remove control gets its own narrow column.
const GRID = 'md:grid md:grid-cols-[28px_76px_minmax(0,1fr)_148px_120px_28px] md:items-center md:gap-3'
// Without the Family column (R2-10): the family sits after the brand chip, in one wider cell.
const GRID_NO_FAMILY = 'md:grid md:grid-cols-[28px_76px_minmax(0,1fr)_220px_28px] md:items-center md:gap-3'

const cell =
  'h-control -mx-2 w-[calc(100%+1rem)] max-w-none min-w-0 rounded border border-line-input bg-surface px-2 text-sm text-fg max-md:text-base md:border-transparent md:bg-transparent ' +
  'placeholder:text-fg-muted hover:border-line-input focus-visible:border-fg focus-visible:bg-surface'

function QtyCell({ item, n, onChange }: { item: DraftItem; n: number; onChange: (patch: Partial<DraftItem>) => void }) {
  // While the cell has focus it shows exactly what is typed; the tidy "2 nos" returns when it loses it.
  const [typing, setTyping] = useState<string | null>(null)
  const shown = item.qty == null ? '' : (qtyText(item.qty, item.unit) ?? `${item.qty} ${item.unit}`.trim())
  // HW-7: a 0 stays on screen as 0 and is marked, never shown (or saved) as 1.
  const problem = qtyProblem(item)
  return (
    <input
      aria-label={`Quantity of item ${n}`}
      aria-invalid={problem ? true : undefined}
      title={problem ?? undefined}
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
      className={cn(cell, 'num', problem && 'border-tone-danger-fg md:border-tone-danger-fg')}
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
  onPicture,
  filled,
}: {
  zoneRef: RefObject<HTMLTextAreaElement>
  onText: (text: string) => void
  /** A screenshot pasted instead of text: read like a chosen picture. */
  onPicture?: (file: File) => void
  filled: boolean
}) {
  const [draft, setDraft] = useState('')
  // A touch screen (a phone, a tablet) has no Ctrl V to press.
  const touch = useMediaQuery('(pointer: coarse)')
  const [hint, setHint] = useState<string | null>(null)
  const pasteFromClipboard = async () => {
    setHint(null)
    try {
      const clip = navigator.clipboard
      if (clip?.read) {
        for (const item of await clip.read()) {
          const picture = item.types.find(t => t.startsWith('image/'))
          if (picture && onPicture) {
            const blob = await item.getType(picture)
            onPicture(new File([blob], `pasted.${picture.split('/')[1] ?? 'png'}`, { type: picture }))
            return
          }
          if (item.types.includes('text/plain')) {
            const text = await (await item.getType('text/plain')).text()
            if (text.trim()) {
              onText(text)
              return
            }
          }
        }
      }
      const text = clip?.readText ? await clip.readText() : ''
      if (text.trim()) {
        onText(text)
        return
      }
      setHint('Nothing to paste: copy the email or the list first.')
    } catch {
      // The browser would not let the page read the clipboard: the box takes a paste the usual way.
      zoneRef.current?.focus()
      setHint('Tap and hold in the box, then Paste.')
    }
  }
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
          const pictures = pastedPictures(e.clipboardData)
          if (!text.trim() && pictures.length && onPicture) {
            e.preventDefault()
            for (const p of pictures) onPicture(p)
            return
          }
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
        placeholder={touch ? 'Tap here to paste, or type one item per line' : 'Click here and paste, or type one item per line'}
        className="w-full resize-y rounded border border-line-input bg-surface px-3 py-2 font-mono text-sm leading-5 text-fg placeholder:text-fg-muted hover:border-fg-muted focus-visible:border-fg max-md:text-base max-md:leading-6"
      />
      {touch ? (
        <Button size="sm" icon={ClipboardPaste} onClick={() => void pasteFromClipboard()}>
          Paste
        </Button>
      ) : null}
      {hint ? (
        <p role="status" className="text-sm text-fg-2">
          {hint}
        </p>
      ) : null}
      <p className="text-xs text-fg-muted">
        {touch ? null : (
          <>
            Press <kbd className="num rounded border border-line-strong bg-sunken px-1">Ctrl</kbd>{' '}
            <kbd className="num rounded border border-line-strong bg-sunken px-1">V</kbd> anywhere on this page.{' '}
          </>
        )}
        Paste the whole email, a PDF or a screenshot — we pick out the items; you check them before saving.
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
      <pre tabIndex={0} role="region" aria-label="What was pasted" className="m-0 max-h-[168px] overflow-auto whitespace-pre-wrap break-words py-2 font-mono text-xs leading-5 text-fg-2">
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
  // The Family column only when a guess is unsure (R2-10): a row whose description named neither a brand nor a family, so the family
  // is the one way left to match suppliers to it. Once the person picks a family in the column it stays, so it does not vanish under
  // their hand. Without the column every row still sets its family, after the brand chip.
  const unsure = familyOptions.length > 0 && items.some(i => i.description.trim() && !i.brandId && !i.familyId)
  const [keepFamily, setKeepFamily] = useState(false)
  const familyColumn = unsure || keepFamily
  const grid = familyColumn ? GRID : GRID_NO_FAMILY
  useEffect(() => {
    if (focusKey) document.getElementById(`item-desc-${focusKey}`)?.focus()
  }, [focusKey])

  return (
    <div className="overflow-hidden rounded border bg-surface">
      {items.length > 0 ? (
        <>
          <div className={cn('hidden min-h-8 border-b bg-sunken px-4 text-xs font-medium text-fg-muted', grid)} aria-hidden="true">
            <span>#</span>
            <span>Qty</span>
            <span>Description</span>
            <span>{familyColumn ? 'Brand' : 'Brand and family'}</span>
            {familyColumn ? <span>Family</span> : null}
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
                    grid,
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
                  <div className={cn('order-3 col-span-3 flex flex-wrap items-center gap-3 md:order-none', familyColumn ? 'md:contents' : 'md:col-span-1 md:min-w-0 md:gap-2')}>
                    <PickCell
                      chip
                      label={`Brand of item ${n}`}
                      value={it.brandId}
                      onChange={v => onChange(it.key, { brandId: v })}
                      options={brandOptions}
                      empty="no brand"
                    />
                    {familyColumn || familyOptions.length > 0 ? (
                      <PickCell
                        label={`Family of item ${n}`}
                        value={it.familyId}
                        onChange={v => {
                          if (familyColumn) setKeepFamily(true)
                          onChange(it.key, { familyId: v })
                        }}
                        options={familyOptions}
                        empty={familyColumn ? 'no family' : '+ family'}
                      />
                    ) : null}
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
