import { useState } from 'react'
import { Check, TriangleAlert } from 'lucide-react'
import { formatAmount } from '@/lib/money'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Checkbox } from '@/ui/form/Checkbox'
import { TextArea } from '@/ui/form/TextField'
import type { RfqItemRow } from '@/features/rfqs/api'
import { reasonLabel, type Suggestion, type SuggestionSet } from '@/features/rfqs/lib'

/*
 * "Paste reply" suggestions (R08 parser, R07 screen). Everything the parser read is offered here and nothing is saved until
 * "Accept". All offers that can be accepted start ticked, so accepting them all is one tap. An offer the parser is unsure of
 * (low confidence, an ambiguous separator, matched by position) is highlighted with the reason. A price with no currency in
 * the reply takes the supplier's pre-filled currency and says so. A regret is offered as "can't quote" with its reason.
 */

function stockText(v: boolean | null) {
  return v === null ? null : v ? 'In stock' : 'Not in stock'
}

export function PasteReplyPanel({
  set,
  items,
  supplierName,
  busy,
  onAccept,
  onCantQuote,
  onCancel,
}: {
  set: SuggestionSet
  items: RfqItemRow[]
  supplierName: string
  busy: boolean
  onAccept: (selected: ReadonlySet<string>) => void
  onCantQuote: (reason: string) => void
  onCancel: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(set.suggestions.filter(s => s.selectable).map(s => s.key)))
  const itemName = (n: number | null) => items.find(i => i.number === n)?.description ?? null
  const count = selected.size
  const declinedOnly = count === 0 && set.declined.length > 0
  const toggle = (s: Suggestion, on: boolean) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (on) next.add(s.key)
      else next.delete(s.key)
      return next
    })

  return (
    <section aria-label={`Read from the reply of ${supplierName}`} className="grid gap-3 rounded border bg-sunken p-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h4 className="text-sm font-semibold">Read from their reply</h4>
        <p className="text-xs text-fg-muted">Nothing is saved until you accept.</p>
      </div>

      {set.nothingFound ? (
        <p className="text-sm text-fg-2">No price, lead time or refusal could be read from that text. Type the prices in above instead.</p>
      ) : null}

      {set.regret ? (
        <div className="flex flex-wrap items-center gap-3 rounded border border-tone-warning-fg/25 bg-tone-warning-bg px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 basis-[14rem]">{`They say they can't quote. Reason: ${reasonLabel(set.regret.reason)}.`}</span>
          <Button variant="primary" size="sm" busy={busy} busyLabel="Saving" onClick={() => onCantQuote(set.regret!.reason)}>
            {"Mark can't quote"}
          </Button>
        </div>
      ) : null}

      {set.suggestions.length > 0 ? (
        <ul className="grid gap-2">
          {set.suggestions.map(s => {
            const flagged = s.check.length > 0
            const name = itemName(s.itemNumber)
            const detail = [stockText(s.inStock), s.leadTimeText].filter(Boolean).join(' · ')
            return (
              <li
                key={s.key}
                data-flagged={flagged ? '' : undefined}
                className={`rounded border px-3 py-2 ${flagged ? 'border-tone-warning-fg/40 bg-tone-warning-bg' : 'border-line bg-surface'}`}
              >
                <Checkbox
                  checked={selected.has(s.key)}
                  disabled={!s.selectable}
                  onCheckedChange={v => toggle(s, v === true)}
                  label={
                    <span className="grid gap-[2px]">
                      <span className="text-sm font-medium">
                        {s.itemNumber !== null ? `Item ${s.itemNumber}` : 'No item matched'}
                        {name ? <span className="font-regular text-fg-muted">{` · ${name.length > 60 ? `${name.slice(0, 57)}...` : name}`}</span> : null}
                      </span>
                      <span className="num text-sm">
                        {s.unitPrice !== null ? (
                          <>
                            <span className="mr-1 font-sans text-xs text-fg-muted">{s.currency}</span>
                            {formatAmount(s.unitPrice, 'always')}
                          </>
                        ) : (
                          <span className="font-sans text-fg-muted">No price</span>
                        )}
                        {detail ? <span className="ml-2 font-sans text-xs text-fg-muted">{detail}</span> : null}
                      </span>
                      {s.currencyFrom === 'supplier' && s.unitPrice !== null ? (
                        <span className="text-xs text-fg-muted">{`No currency in the reply: ${s.currency} is this supplier's usual.`}</span>
                      ) : null}
                    </span>
                  }
                />
                {flagged ? (
                  <ul className="mt-1 grid gap-[2px] pl-[30px] text-xs text-tone-warning-fg">
                    {s.check.map(c => (
                      <li key={c} className="flex items-start gap-1">
                        <Icon icon={TriangleAlert} size="chip" className="mt-[2px]" />
                        {c}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {s.blocked ? <p className="mt-1 pl-[30px] text-xs text-fg-muted">{s.blocked}</p> : null}
                {s.snippet ? <p className="mt-1 break-words pl-[30px] text-xs text-fg-muted">{`From: ${s.snippet}`}</p> : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      {set.declined.length > 0 ? (
        <p className="text-sm text-fg-2">
          {`They decline ${set.declined.map(d => `item ${d.itemNumber}`).join(', ')}. Accepting records that as can't quote: ${[...new Set(set.declined.map(d => reasonLabel(d.reason)))].join(', ')}.`}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button data-cancel onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {!set.nothingFound && !(set.regret && count === 0 && set.declined.length === 0) ? (
          <Button
            variant="primary"
            icon={Check}
            busy={busy}
            busyLabel="Saving"
            disabled={count === 0 && !declinedOnly}
            onClick={() => onAccept(selected)}
          >
            {declinedOnly ? "Record can't quote" : `Accept ${count} ${count === 1 ? 'offer' : 'offers'}`}
          </Button>
        ) : null}
      </div>
    </section>
  )
}

/** The fallback when the browser will not let the page read the clipboard: paste into a box, then read it. */
export function PasteBox({ onRead, onCancel }: { onRead: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('')
  return (
    <section aria-label="Paste their reply" className="grid gap-2 rounded border bg-sunken p-3">
      <label className="grid gap-1 text-sm font-medium">
        Paste what they sent
        <TextArea
          autoFocus
          rows={5}
          value={text}
          onChange={e => setText(e.target.value)}
          onPaste={e => {
            const pasted = e.clipboardData.getData('text/plain')
            if (pasted) {
              e.preventDefault()
              onRead(pasted)
            }
          }}
          placeholder="Paste the email or message here"
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button data-cancel onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!text.trim()} onClick={() => onRead(text)}>
          Read it
        </Button>
      </div>
    </section>
  )
}
