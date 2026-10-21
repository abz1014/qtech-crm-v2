import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { useBackToClose } from '@/lib/useBackToClose'
import { Command } from 'cmdk'
import { ArrowDown, ArrowUp, Building2, CornerDownLeft, FileText, Package, Search, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { modKeyLabel, type PaletteItem, type PaletteSource } from '@/ui/paletteSources'
import { useMediaQuery } from '@/lib/useMediaQuery'

/*
 * CommandPalette (INVENTORY: U08; D08 section 07). Cmd+K or Ctrl+K from anywhere,
 * or the search button in the top bar. One input, grouped results, everything
 * reachable from the keyboard: Up/Down move, Enter opens, Cmd/Ctrl+Enter opens in
 * a new tab, Esc closes and returns focus to what had it.
 *
 * It is a shell: it knows nothing about RFQs or companies. Features plug in
 * `PaletteSource`s:
 *   idle(ctx)    rows to show before anything is typed (actions, "go to").
 *   search(q)    rows for the typed text; may be async. The palette cancels the
 *                signal when the text changes, and shows skeleton rows if a
 *                search is still running after 200 ms.
 * Results keep their source order, so places come before actions as the sources
 * are ordered. Recently opened rows (those with an href) are remembered.
 *
 * Built on Radix Dialog + cmdk directly (not the Dialog wrapper): the palette is
 * a 640px top-anchored surface with no header or footer band. It keeps the same
 * guarantees: focus trap, Esc, an accessible name, focus returned on close.
 * cmdk's own filter is off: sources decide what matches (see `filterItems`).
 */
interface Recent {
  id: string
  label: string
  meta?: string
  href: string
  at: number
}

/**
 * Recents are kept per person (BUG-RV-04): `qtech.palette.recent.<user id>`. The old shared key is never read, and sign-out
 * removes every one (forgetPaletteRecents in src/lib/capture/forget.ts). With no person, nothing is remembered.
 */
const RECENT_PREFIX = 'qtech.palette.recent.'
const RECENT_MAX = 5

function loadRecents(personId: string | undefined): Recent[] {
  if (!personId) return []
  try {
    const raw = window.localStorage.getItem(RECENT_PREFIX + personId)
    const list = raw ? (JSON.parse(raw) as Recent[]) : []
    return Array.isArray(list) ? list.filter(r => r && typeof r.href === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}
function saveRecent(personId: string | undefined, item: PaletteItem) {
  if (!item.href || !personId) return
  try {
    const next: Recent = { id: item.id, label: item.label, meta: item.meta, href: item.href, at: Date.now() }
    const list = [next, ...loadRecents(personId).filter(r => r.href !== item.href)].slice(0, RECENT_MAX)
    window.localStorage.setItem(RECENT_PREFIX + personId, JSON.stringify(list))
  } catch {
    // storage blocked: recents are a convenience only
  }
}

/** Recent rows keep only their route, so the icon follows the kind of place it opens: RFQ, company, order. */
function recentIcon(href: string): LucideIcon {
  if (href.startsWith('/companies')) return Building2
  if (href.startsWith('/orders')) return Package
  return FileText
}

function ago(at: number): string {
  const mins = Math.round((Date.now() - at) / 60_000)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (mins < 1) return 'Opened just now'
  if (mins < 60) return `Opened ${rtf.format(-mins, 'minute')}`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `Opened ${rtf.format(-hrs, 'hour')}`
  return `Opened ${rtf.format(-Math.round(hrs / 24), 'day')}`
}

interface Group {
  key: string
  heading: string
  items: PaletteItem[]
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sources: readonly PaletteSource[]
  /** Opens a route. The palette never imports the router. */
  onNavigate: (href: string, opts: { newTab: boolean }) => void
  /** What the search covers, shown when nothing matched. */
  emptyHint?: ReactNode
  /** The signed-in person: Recent is kept for them alone. Without one, nothing is remembered. */
  personId?: string
  /** Text the search box starts with each time it opens (`usePalette().open(q)`); empty when not given. */
  initialQuery?: string
  /** Shows "? Shortcuts" in the footer (the shell passes it; the sheet is opened with the ? key). */
  shortcutsHint?: boolean
}

export function CommandPalette({
  open,
  onOpenChange,
  sources,
  onNavigate,
  emptyHint,
  personId,
  initialQuery = '',
  shortcutsHint = false,
}: CommandPaletteProps) {
  const [query, setQuery] = useState(open ? initialQuery : '')
  useBackToClose(open, () => onOpenChange(false), { enabled: useMediaQuery('(max-width: 767px), (pointer: coarse)') })
  const [groups, setGroups] = useState<Group[]>([])
  const [searching, setSearching] = useState(false)
  const [slow, setSlow] = useState(false)
  const [settled, setSettled] = useState(false)
  const itemsById = useRef(new Map<string, PaletteItem>())
  const openerRef = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Cmd+K / Ctrl+K from anywhere.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const ordered = useMemo(
    () => sources.map((s, i) => ({ s, i })).sort((a, b) => (a.s.order ?? 0) - (b.s.order ?? 0) || a.i - b.i).map(x => x.s),
    [sources],
  )

  // However it closed (a row opened, Esc, Cmd+K again, the parent), it opens empty next time, or with the text it was opened with.
  useEffect(() => {
    setQuery(open ? initialQuery : '')
  }, [open, initialQuery])

  // Fill the list: idle rows for an empty box, search results otherwise.
  useEffect(() => {
    if (!open) return
    const ctl = new AbortController()
    const q = query.trim()
    setSettled(false)
    const slots: Group[][] = ordered.map(() => [])
    const publish = () => {
      const merged = slots.flat().filter(g => g.items.length)
      itemsById.current = new Map(merged.flatMap(g => g.items.map(i => [`${g.key}:${i.id}`, i] as const)))
      setGroups([...(q ? [] : recentGroup()), ...merged])
    }
    const recentGroup = (): Group[] => {
      const r = loadRecents(personId)
      return r.length
        ? [{ key: 'recent', heading: 'Recent', items: r.map(x => ({ id: x.id, label: x.label, meta: ago(x.at), href: x.href, icon: recentIcon(x.href) })) }]
        : []
    }

    let pendingCount = 0
    const timer = window.setTimeout(() => !ctl.signal.aborted && pendingCount > 0 && setSlow(true), 200)
    setSlow(false)
    const done = () => {
      pendingCount -= 1
      if (pendingCount <= 0 && !ctl.signal.aborted) {
        setSearching(false)
        setSlow(false)
        setSettled(true)
      }
    }
    ordered.forEach((s, idx) => {
      const produce = q ? s.search : s.idle
      if (!produce) return
      pendingCount += 1
      Promise.resolve()
        .then(() => (q ? (s.search as NonNullable<typeof s.search>)(q, ctl.signal) : (s.idle as NonNullable<typeof s.idle>)()))
        .then(items => {
          if (ctl.signal.aborted) return
          // A source may split its rows into several groups (item.group), keeping the order it gave them.
          const byHeading = new Map<string, PaletteItem[]>()
          for (const it of items) {
            const heading = it.group ?? s.group
            byHeading.set(heading, [...(byHeading.get(heading) ?? []), it])
          }
          slots[idx] = [...byHeading].map(([heading, rows]) => ({ key: byHeading.size > 1 || heading !== s.group ? `${s.id}/${heading}` : s.id, heading, items: rows }))
          publish()
        })
        .catch(() => {
          /* one failing source must not blank the others */
        })
        .finally(done)
    })
    setSearching(pendingCount > 0)
    publish()
    if (pendingCount === 0) setSettled(true)
    return () => {
      ctl.abort()
      window.clearTimeout(timer)
    }
  }, [open, query, ordered, personId])

  const close = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const run = (item: PaletteItem, newTab: boolean) => {
    saveRecent(personId, item)
    close()
    if (item.onSelect) item.onSelect({ newTab })
    else if (item.href) onNavigate(item.href, { newTab })
  }

  // Cmd/Ctrl+Enter: open the highlighted row in a new tab (cmdk handles plain Enter).
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      e.stopPropagation()
      const key = e.currentTarget.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]')?.getAttribute('data-value')
      const item = key ? itemsById.current.get(key) : undefined
      if (item) run(item, true)
    }
  }

  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const q = query.trim()
  const m = modKeyLabel()

  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={onOpenChange}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 animate-fade-in bg-scrim" />
        <RadixDialog.Content
          aria-describedby={undefined}
          ref={contentRef}
          onOpenAutoFocus={e => {
            e.preventDefault()
            openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
            contentRef.current?.querySelector<HTMLElement>('[cmdk-input]')?.focus()
          }}
          // No <Trigger> here (the button and Cmd+K are elsewhere): put focus back on whatever had it.
          onCloseAutoFocus={e => {
            e.preventDefault()
            if (openerRef.current?.isConnected) openerRef.current.focus()
          }}
          className="fixed left-1/2 top-[96px] z-50 flex max-h-[calc(100dvh-112px)] w-[640px] flex-col max-md:max-h-[calc(100dvh-32px)] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded bg-surface shadow-modal focus:outline-none max-md:top-4"
        >
          <RadixDialog.Title className="sr-only">Search or jump to</RadixDialog.Title>
          <Command shouldFilter={false} loop label="Search or jump to" onKeyDownCapture={onKeyDownCapture} className="flex min-h-0 flex-col">
            <div className="flex min-h-[calc(var(--control-h)+16px)] shrink-0 items-center gap-3 border-b px-4">
              <Icon icon={Search} size="lg" className="text-fg-muted" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search or jump to"
                className="min-w-0 flex-1 bg-transparent text-lg text-fg placeholder:text-fg-muted focus:outline-none"
              />
              <Kbd className="text-xs">Esc</Kbd>
            </div>

            <Command.List className="max-h-[min(480px,60dvh)] min-h-0 overflow-y-auto pb-2 pt-1">
              {groups.map(g => (
                <Command.Group
                  key={g.key}
                  heading={g.heading}
                  className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted"
                >
                  {g.items.map(item => (
                    <Command.Item
                      key={item.id}
                      value={`${g.key}:${item.id}`}
                      onSelect={() => run(item, false)}
                      className="group relative flex h-row cursor-pointer items-center gap-3 px-4 text-sm data-[selected=true]:bg-selected"
                    >
                      <span aria-hidden="true" className="absolute inset-y-0 left-0 hidden w-[3px] bg-brand-green group-data-[selected=true]:block" />
                      {item.icon ? <Icon icon={item.icon} className="text-fg-muted group-data-[selected=true]:text-fg" /> : <span className="w-4" />}
                      <span className="min-w-0 flex-1 truncate">
                        <Highlight text={item.label} q={q} />
                      </span>
                      {item.meta ? (
                        <span className="min-w-0 max-w-[45%] shrink-0 truncate text-xs text-fg-muted">
                          <Highlight text={item.meta} q={g.key === 'recent' ? '' : q} />
                        </span>
                      ) : null}
                      {item.shortcut?.length ? (
                        <span className="inline-flex gap-1">
                          {item.shortcut.map(k => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </span>
                      ) : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>

            {/* Status lines sit beside the listbox, not inside it: a listbox may only hold options and groups. */}
            {slow && searching ? (
              <div role="status" aria-label="Searching" className="grid pb-1">
                <p className="px-4 pb-1 pt-3 text-xs font-semibold text-fg-muted">Searching</p>
                {[60, 42, 52].map(w => (
                  <div key={w} className="flex h-row items-center gap-3 px-4">
                    <span className="size-4 rounded-round border border-line-strong" />
                    <span className="h-[10px] animate-pulse rounded bg-selected motion-reduce:animate-none" style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
            ) : null}

            {settled && !searching && total === 0 && q ? (
              <div role="status" className="grid justify-items-center gap-2 px-6 py-8 text-center text-sm text-fg-muted">
                <span className="grid size-10 place-items-center rounded bg-selected text-fg-2">
                  <Icon icon={Search} size="lg" />
                </span>
                <b className="font-medium text-fg">Nothing found for “{q}”</b>
                <p className="max-w-prose text-pretty">{emptyHint ?? 'Try one word, or check the spelling.'}</p>
              </div>
            ) : null}

            <div className="flex min-h-head items-center gap-4 border-t bg-sunken px-4 py-1 text-xs text-fg-muted">
              <span className="inline-flex items-center gap-[6px]">
                <Kbd><Icon icon={ArrowUp} size="chip" /></Kbd>
                <Kbd><Icon icon={ArrowDown} size="chip" /></Kbd>
                move
              </span>
              <span className="inline-flex items-center gap-[6px]">
                <Kbd><Icon icon={CornerDownLeft} size="chip" /></Kbd>
                open
              </span>
              <span className="inline-flex items-center gap-[6px] max-md:hidden">
                <Kbd>{m}</Kbd>
                <Kbd><Icon icon={CornerDownLeft} size="chip" /></Kbd>
                open in new tab
              </span>
              {shortcutsHint ? (
                <span className="inline-flex items-center gap-[6px] max-md:hidden">
                  <Kbd>?</Kbd>
                  Shortcuts
                </span>
              ) : null}
              <span className={cn('num ml-auto', !q && 'hidden')} aria-live="polite">
                {total} {total === 1 ? 'result' : 'results'}
              </span>
            </div>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/** Matches in the typed text are semibold. */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const lower = text.toLowerCase()
  const marks = new Array<boolean>(text.length).fill(false)
  for (const w of words) {
    let at = lower.indexOf(w)
    while (at >= 0) {
      for (let i = at; i < at + w.length; i++) marks[i] = true
      at = lower.indexOf(w, at + w.length)
    }
  }
  const out: ReactNode[] = []
  let i = 0
  while (i < text.length) {
    let j = i
    while (j < text.length && marks[j] === marks[i]) j++
    const chunk = text.slice(i, j)
    out.push(marks[i] ? <b key={i} className="font-semibold text-fg">{chunk}</b> : chunk)
    i = j
  }
  return <>{out}</>
}
