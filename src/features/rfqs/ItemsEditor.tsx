import { htmlTableText, pastedText } from '@/lib/docread/htmlTable'
import { useEffect, useState, type RefObject } from 'react'
import { CircleAlert, CircleCheck, ClipboardPaste, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { pastedPictures } from '@/features/rfqs/lib/readPdf'
import { textAfterMarker, type BrandRef, type ParseResult } from '@/features/rfqs/lib/parseItems'
import { parseQtyCell, qtyProblem, type DraftItem } from '@/features/rfqs/lib/intakeModel'
import { qtyText } from '@/features/rfqs/lib/enquiryDraft'
import { Button } from '@/ui/Button'
import { controlClass } from '@/ui/form/fieldContext'
import { Select } from '@/ui/form/Select'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'

/*
 * Items (g2-intake-float frames 1 and 3; Forest 21-new-enquiry .qb-itemrow): one paste becomes rows. The paste zone is a real text
 * area (so a phone can paste into it) and the whole page listens for a paste, so on a desktop the person presses Ctrl+V with nothing
 * focused. A phone has no Ctrl+V: it gets a Paste button instead (the clipboard read where the browser allows it, else "press and
 * hold in the box, then Paste"). A pasted screenshot is read like a chosen one. Each row is its own bordered tile (quantity,
 * description, brand, family, remove); where the list is wide enough (a container of 38rem, so the same rule holds beside the
 * customer's document) the tile becomes one line under a column head. Quantity starts at 1 when the paste gave none.
 */

export interface PastedBlock {
  result: ParseResult
}

/*
 * The row (proposal.css .qb-itemrow): narrow, "n qty x / description / brand family"; from a 38rem container, one line
 * "n qty description brand family x". The class strings are written out in full so Tailwind finds them.
 */
const ROW_WIDE = '[@container(min-width:38rem)]:grid-cols-[2rem_minmax(0,1.2fr)_minmax(0,4fr)_minmax(0,2fr)_minmax(0,2fr)_auto]'
const HEAD_WIDE = '[@container(min-width:38rem)]:grid [@container(min-width:38rem)]:grid-cols-[2rem_minmax(0,1.2fr)_minmax(0,4fr)_minmax(0,2fr)_minmax(0,2fr)_auto]'
const ROW_WIDE_NO_FAMILY = '[@container(min-width:38rem)]:grid-cols-[2rem_minmax(0,1.2fr)_minmax(0,5fr)_minmax(0,2.5fr)_auto]'
const HEAD_WIDE_NO_FAMILY = '[@container(min-width:38rem)]:grid [@container(min-width:38rem)]:grid-cols-[2rem_minmax(0,1.2fr)_minmax(0,5fr)_minmax(0,2.5fr)_auto]'
/** A cell's own label: shown on the narrow tile, read only by a screen reader once the column head names the column. */
const CELL_LABEL = 'text-sm font-card text-fg [@container(min-width:38rem)]:sr-only'

function QtyCell({ item, n, onChange }: { item: DraftItem; n: number; onChange: (patch: Partial<DraftItem>) => void }) {
  // While the cell has focus it shows exactly what is typed; the tidy "2 nos" returns when it loses it.
  const [typing, setTyping] = useState<string | null>(null)
  const shown = item.qty == null ? '' : (qtyText(item.qty, item.unit) ?? `${item.qty} ${item.unit}`.trim())
  // HW-7: a 0 stays on screen as 0 and is marked, never shown (or saved) as 1.
  const problem = qtyProblem(item)
  const id = `item-qty-${item.key}`
  return (
    <div className="grid min-w-0 content-start gap-1">
      <label htmlFor={id} className={CELL_LABEL}>
        Quantity<span className="sr-only"> of item {n}</span>
      </label>
      <input
        id={id}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-err` : undefined}
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
        className={cn(controlClass, 'num')}
      />
      {problem ? (
        <p id={`${id}-err`} className="flex items-start gap-1 text-xs font-card text-tone-danger-fg">
          <Icon icon={CircleAlert} size="sm" className="mt-[calc((var(--lh-xs)-14px)/2)] shrink-0" />
          <span className="min-w-0 text-pretty">{problem}</span>
        </p>
      ) : null}
    </div>
  )
}

/** Brand or family of one row: the Forest select, labelled for the row ("Brand of item 2"). */
function PickCell({ id, label, n, value, onChange, options, empty }: { id: string; label: string; n: number; value: string | null; onChange: (v: string | null) => void; options: { value: string; label: string }[]; empty: string }) {
  return (
    <div className="grid min-w-0 content-start gap-1">
      <label htmlFor={id} className={CELL_LABEL}>
        {label}
        <span className="sr-only"> of item {n}</span>
      </label>
      <Select id={id} value={value ?? ''} onChange={e => onChange(e.target.value || null)} options={options} placeholder={empty} />
    </div>
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
      try {
        if (clip?.read) {
          for (const item of await clip.read()) {
            const picture = item.types.find(t => t.startsWith('image/'))
            if (picture && onPicture) {
              const blob = await item.getType(picture)
              onPicture(new File([blob], `pasted.${picture.split('/')[1] ?? 'png'}`, { type: picture }))
              return
            }
            const fromHtml = item.types.includes('text/html') ? htmlTableText(await (await item.getType('text/html')).text()) : null
            if (fromHtml?.trim()) {
              onText(fromHtml)
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
      } catch {
        // The rich read (pictures, HTML) was refused: the plain text is tried next, before giving up.
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
      setHint('Press and hold in the box, then Paste.')
    }
  }
  return (
    // Forest .ne-paste: a dashed tile, the green clipboard glyph, the box, and the one line that says what a paste does.
    <div className="grid min-w-0 justify-items-start gap-2 rounded-card border-2 border-dashed border-line-input p-4 transition-colors duration-fast ease-out focus-within:border-brand-700 focus-within:bg-brand-100">
      {filled ? null : <Icon icon={ClipboardPaste} size="lg" className="text-brand-700" />}
      <label htmlFor="intake-paste" className="text-sm font-card text-fg">
        {filled ? 'Paste another email or list' : "Paste the customer's email or item list"}
      </label>
      <textarea
        id="intake-paste"
        ref={zoneRef}
        rows={filled ? 2 : 3}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onPaste={e => {
          // Parsed straight from the clipboard, so one paste is one action. The page-level listener does the same
          // for a paste made with nothing focused.
          const text = pastedText(e.clipboardData)
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
        placeholder={touch ? 'Select here to paste, or type one item per line' : 'Click here and paste, or type one item per line'}
        className={cn(controlClass, 'h-auto resize-y py-2 font-mono leading-6')}
      />
      {touch ? (
        <Button size="touch" icon={ClipboardPaste} onClick={() => void pasteFromClipboard()}>
          Paste
        </Button>
      ) : null}
      {hint ? (
        <p role="status" className="text-base text-fg-2">
          {hint}
        </p>
      ) : null}
      <p className="text-sm text-fg-muted">
        {touch ? null : (
          <>
            Press <Kbd size="inline">Ctrl</Kbd> <Kbd size="inline">V</Kbd> anywhere on this page.{' '}
          </>
        )}
        Paste the whole email, a PDF or a screenshot. The items are picked out and can be checked before saving.
      </p>
    </div>
  )
}

export function PastedPanel({ block }: { block: PastedBlock }) {
  const { result } = block
  const found = result.items.length
  return (
    // Forest .ne-pasted: what was read stays in view above the rows, greetings and sign-offs marked as skipped.
    <div className="grid min-w-0 gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
        <Icon icon={ClipboardPaste} size="sm" />
        <span>
          Pasted just now · <span className="num">{result.lineCount}</span> {result.lineCount === 1 ? 'line' : 'lines'}
        </span>
        <span
          className={cn(
            'ml-auto inline-flex min-h-chip shrink-0 items-center gap-1 whitespace-nowrap rounded-pill px-3 text-xs font-bold',
            found === 0 ? 'bg-tone-warning-bg text-tone-warning-fg' : 'bg-tone-success-bg text-tone-success-fg',
          )}
        >
          <Icon icon={found === 0 ? CircleAlert : CircleCheck} size="chip" />
          {found === 0 ? 'No items found' : `${found} ${found === 1 ? 'item' : 'items'} found`}
        </span>
      </div>
      <pre tabIndex={0} role="region" aria-label="What was pasted" className="m-0 max-h-[10.5rem] overflow-auto whitespace-pre-wrap break-words rounded-control bg-sunken px-3 py-2 font-mono text-sm leading-6 text-fg-2 max-md:text-base">
        {result.lines.map((l, i) => (
          <span key={i} className={cn('block', l.kind === 'skipped' && 'bg-tone-warning-bg text-tone-warning-fg')}>
            {l.marker ? <mark className="rounded bg-brand-100 px-1 text-fg">{l.marker}</mark> : null}
            {l.marker ? ' ' : ''}
            {textAfterMarker(l)}
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
  // Every row sets its brand and its family (Forest .qb-itemrow); the family select is left out only when no family is on file.
  const family = familyOptions.length > 0
  useEffect(() => {
    if (focusKey) document.getElementById(`item-desc-${focusKey}`)?.focus()
  }, [focusKey])

  return (
    <div className="grid min-w-0 gap-3 [container-type:inline-size]">
      {items.length > 0 ? (
        <>
          <div aria-hidden="true" className={cn('hidden gap-3 px-3 text-sm font-card text-fg-muted', family ? HEAD_WIDE : HEAD_WIDE_NO_FAMILY)}>
            <span />
            <span>Qty</span>
            <span>Description</span>
            <span>Brand</span>
            {family ? <span>Family</span> : null}
            <span />
          </div>
          <ol aria-label="Items" className="m-0 grid list-none gap-3 p-0">
            {items.map((it, idx) => {
              const n = idx + 1
              return (
                <li
                  key={it.key}
                  data-flag={flagged.includes(it.key) || undefined}
                  className={cn(
                    'grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-control border bg-surface p-3 transition-colors duration-fast ease-out focus-within:border-line-strong',
                    family ? ROW_WIDE : ROW_WIDE_NO_FAMILY,
                    flagged.includes(it.key) && 'bg-tone-warning-bg',
                  )}
                >
                  <span className="num grid min-h-control place-items-center text-base font-card text-fg-muted mt-[calc(var(--lh-sm)+var(--sp-1))] [@container(min-width:38rem)]:mt-0">{n}</span>
                  <QtyCell item={it} n={n} onChange={patch => onChange(it.key, patch)} />
                  <div className="col-span-3 grid min-w-0 content-start gap-1 [@container(min-width:38rem)]:col-span-1">
                    <label htmlFor={`item-desc-${it.key}`} className={CELL_LABEL}>
                      Description<span className="sr-only"> of item {n}</span>
                    </label>
                    <textarea
                      id={`item-desc-${it.key}`}
                      value={it.description}
                      onChange={e => onChange(it.key, { description: e.target.value })}
                      placeholder="What the customer asked for"
                      autoComplete="off"
                      rows={2}
                      title={it.description}
                      className={cn(controlClass, 'h-auto min-h-control resize-y py-2 leading-6 [@container(min-width:38rem)]:resize-none')}
                    />
                  </div>
                  <div className={cn('col-span-3 grid min-w-0 gap-3 [@container(min-width:38rem)]:contents', family ? 'grid-cols-2' : 'grid-cols-1')}>
                    <PickCell id={`item-brand-${it.key}`} label="Brand" n={n} value={it.brandId} onChange={v => onChange(it.key, { brandId: v })} options={brandOptions} empty="No brand" />
                    {family ? (
                      <PickCell id={`item-family-${it.key}`} label="Family" n={n} value={it.familyId} onChange={v => onChange(it.key, { familyId: v })} options={familyOptions} empty="No family" />
                    ) : null}
                  </div>
                  <Button
                    variant="quiet"
                    icon={X}
                    aria-label={`Remove item ${n}`}
                    onClick={() => onRemove(it.key)}
                    className="col-start-3 row-start-1 mt-[calc(var(--lh-sm)+var(--sp-1))] justify-self-end max-md:size-touch [@container(min-width:38rem)]:mt-0 [@container(min-width:38rem)]:col-start-auto [@container(min-width:38rem)]:row-start-auto"
                  />
                </li>
              )
            })}
          </ol>
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm text-fg-muted">
        <span className="min-w-[10rem] flex-1 text-pretty">{note}</span>
        <Button variant="quiet" icon={Plus} className="ml-auto shrink-0" onClick={onAdd}>
          Add item
        </Button>
      </div>
    </div>
  )
}
