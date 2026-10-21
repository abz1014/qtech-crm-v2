import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Building2, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CompanyHit, CompanyRole } from '@/features/companies/api'
import { CreateCompanyInline } from '@/features/companies/CreateCompanyInline'
import { useCompanyMatches } from '@/features/rfqs/hooks'
import { optionMeta } from '@/features/rfqs/lib/intakeModel'
import { controlClass } from '@/ui/form/fieldContext'
import { Field } from '@/ui/form/Field'
import { Icon } from '@/ui/Icon'

/*
 * The company picker of the intake screen (g2-intake-float frames 1 and 2). One search field; the matches carry
 * "City · customer · 2 RFQs · similar name" so a near-duplicate is seen before a new company is made; when the name is
 * not on file the last row offers "Add “X” as a new company" and opens the create form right here, in the page, with
 * the company name, an optional city and an optional first contact: [Create and use] [Cancel]. Nothing else is asked.
 * The list is in the flow (as drawn), not a floating layer, so the create form can never be clipped.
 */

export interface IntakeCompany {
  id: string
  name: string
  country: string | null
  city: string | null
  role: CompanyRole | null
}

export function CompanyPicker({ onPick, loadingName }: { onPick: (c: IntakeCompany) => void; loadingName: boolean }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [creating, setCreating] = useState(false)
  const listId = useId()
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const matches = useCompanyMatches(text)
  const hits = matches.data ?? []
  const typed = text.trim()
  const canCreate = typed !== '' && !hits.some(h => h.name.trim().toLowerCase() === typed.toLowerCase())
  const rows = hits.length + (canCreate ? 1 : 0)
  const activeIndex = Math.min(active, Math.max(rows - 1, 0))
  const showList = open && typed !== ''
  const optionId = (i: number) => `${listId}-o${i}`

  const pick = (h: CompanyHit) => {
    onPick({ id: h.id, name: h.name, country: h.country, city: h.city ?? null, role: h.role })
    setOpen(false)
  }
  const choose = (i: number) => (i < hits.length ? pick(hits[i]) : setCreating(true))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!showList) setOpen(true)
      else setActive(Math.min(activeIndex + 1, rows - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(activeIndex - 1, 0))
    } else if (e.key === 'Enter' && showList && rows > 0) {
      e.preventDefault()
      choose(activeIndex)
    } else if (e.key === 'Escape' && showList) {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div
      ref={box}
      onBlur={e => {
        // Leaving the picker closes the list; moving between its own fields does not, and the create form stays up.
        if (!creating && !box.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <Field label="Company" id="intake-company">
        <div className="relative min-w-0">
          <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            ref={input}
            id="intake-company"
            type="text"
            role="combobox"
            aria-expanded={showList}
            aria-controls={showList ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={showList && rows > 0 ? optionId(activeIndex) : undefined}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={text}
            placeholder={loadingName ? 'Opening the customer' : 'Search, or type a new company name'}
            onChange={e => {
              setText(e.target.value)
              setOpen(true)
              setActive(0)
              setCreating(false)
            }}
            onFocus={e => e.currentTarget.select()}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={cn(controlClass, 'pl-[36px]')}
          />
        </div>
      </Field>

      {showList ? (
        <div className="mt-1 rounded bg-surface p-1 shadow-pop">
          <ul id={listId} role="listbox" aria-label="Matches" onMouseDown={e => e.preventDefault()} className="m-0 grid list-none p-0">
            {hits.map((h, i) => (
              <li
                key={h.id}
                id={optionId(i)}
                role="option"
                aria-selected={false}
                data-active={i === activeIndex || undefined}
                onMouseMove={() => setActive(i)}
                onClick={() => pick(h)}
                className={cn('flex min-h-[44px] cursor-pointer items-center gap-3 rounded px-3 py-2 text-sm', i === activeIndex && 'bg-selected')}
              >
                <Icon icon={Building2} className="text-fg-muted" />
                <span className="grid min-w-0 flex-1">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{h.name}</span>
                  {optionMeta(h) ? <span className="min-w-0 [overflow-wrap:anywhere] text-xs text-fg-muted">{optionMeta(h)}</span> : null}
                </span>
              </li>
            ))}
            {rows === 0 ? (
              <li role="presentation" className="flex min-h-[44px] items-center gap-2 px-3 text-sm text-fg-muted">
                <Icon icon={Search} />
                {matches.isFetching ? 'Searching' : `No match for “${typed}”`}
              </li>
            ) : null}
            {canCreate ? (
              <>
                {hits.length > 0 ? <li role="presentation" className="my-1 border-t border-line" /> : null}
                <li
                  id={optionId(hits.length)}
                  role="option"
                  aria-selected={creating}
                  data-active={hits.length === activeIndex || undefined}
                  onMouseMove={() => setActive(hits.length)}
                  onClick={() => setCreating(true)}
                  className={cn('flex min-h-[44px] cursor-pointer items-center gap-3 rounded px-3 py-2 text-sm', hits.length === activeIndex && 'bg-selected')}
                >
                  <Icon icon={Plus} className="text-primary" />
                  <span className="grid min-w-0 flex-1">
                    <span className="min-w-0 [overflow-wrap:anywhere]">Add “{typed}” as a new company</span>
                    <span className="text-xs text-fg-muted">Saved as a prospect until the first order</span>
                  </span>
                  <kbd aria-hidden="true" className="hidden rounded border border-line-strong bg-sunken px-1 text-xs text-fg-muted sm:inline">
                    ⏎
                  </kbd>
                </li>
              </>
            ) : null}
          </ul>
          {creating && canCreate ? (
            <CreateCompanyInline
              initialName={typed}
              onCancel={() => {
                setCreating(false)
                input.current?.focus()
              }}
              onCreated={c => onPick({ id: c.id, name: c.name, country: null, city: c.city ?? null, role: 'prospect' })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
