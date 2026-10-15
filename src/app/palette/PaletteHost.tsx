import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, CalendarCheck, ClipboardPaste, Plus } from 'lucide-react'
import { navItemsForRole } from '@/app/navConfig'
import { PaletteContext, type PaletteApi } from '@/app/palette/usePalette'
import { CommandPalette } from '@/ui/CommandPalette'
import { Kbd } from '@/ui/Kbd'
import { filterItems, type PaletteItem, type PaletteSource } from '@/ui/paletteSources'

/** Where the shortcut actions go. Capture (a pasted message or photo) is part of intake today, so both open it. */
const INTAKE_ROUTE = '/rfqs/new'
const TODAY_ROUTE = '/today'

/** True when a key press belongs to something the person is typing into or a dialog they are in. */
function isTypingContext(e: KeyboardEvent): boolean {
  const t = e.target
  if (t instanceof HTMLElement) {
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return true
    if (t.closest('[role="textbox"],[role="combobox"],[role="searchbox"],[role="listbox"],[role="menu"]')) return true
  }
  return Boolean(document.querySelector('[role="dialog"],[role="alertdialog"]'))
}

/*
 * Palette host (U08). Owns the open state of the one command palette in the
 * shell, the registry of sources, and the built-in "Go to" source (the role's
 * destinations, so a role never sees a place it cannot open). Features add their
 * own sources with usePaletteSource(): R12 registers search (companies, contacts,
 * RFQ numbers), screens register their actions ("New RFQ") while they are mounted.
 */
export function PaletteHost({ role, children }: { role: string; children: ReactNode }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [extra, setExtra] = useState<PaletteSource[]>([])
  const seq = useRef(0)

  const register = useCallback((source: PaletteSource) => {
    const tagged = { ...source, id: `${source.id}#${seq.current++}` }
    setExtra(list => [...list, tagged])
    return () => setExtra(list => list.filter(s => s !== tagged))
  }, [])

  const goTo = useMemo<PaletteSource>(() => {
    const items: PaletteItem[] = navItemsForRole(role).map(n => ({
      id: n.key,
      label: n.label,
      icon: n.icon,
      meta: 'Go to',
      href: n.path,
    }))
    return {
      id: 'go-to',
      group: 'Jump to',
      order: 5,
      search: q => filterItems(items, q),
    }
  }, [role])

  // Actions (A-89): idle rows in the palette, and the same keys work anywhere outside a text field: N, C, G then T.
  const actions = useMemo<PaletteSource>(() => {
    const items: PaletteItem[] = [
      { id: 'new-rfq', label: 'New RFQ', meta: 'Go to intake', icon: Plus, shortcut: ['N'], href: INTAKE_ROUTE },
      { id: 'capture', label: 'Capture a message or photo', icon: ClipboardPaste, shortcut: ['C'], href: INTAKE_ROUTE },
      { id: 'go-today', label: 'Go to Today', icon: CalendarCheck, shortcut: ['G T'], href: TODAY_ROUTE },
      { id: 'new-company', label: 'New company', icon: Building2, href: '/companies?new=1' },
    ]
    return { id: 'actions', group: 'Actions', order: 90, idle: () => items }
  }, [])

  useEffect(() => {
    let armedAt = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTypingContext(e)) return
      const k = e.key.toLowerCase()
      if (k === 'g') {
        armedAt = Date.now()
        return
      }
      const armed = Date.now() - armedAt < 1000
      armedAt = 0
      if (k === 'n' || k === 'c') {
        e.preventDefault()
        navigate(INTAKE_ROUTE)
      } else if (k === 't' && armed) {
        e.preventDefault()
        navigate(TODAY_ROUTE)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const sources = useMemo(() => [...extra, actions, goTo], [extra, actions, goTo])
  const api = useMemo<PaletteApi>(() => ({ open: () => setOpen(true), register }), [register])

  return (
    <PaletteContext.Provider value={api}>
      {children}
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        sources={sources}
        onNavigate={(href, { newTab }) => (newTab ? window.open(href, '_blank', 'noopener') : navigate(href))}
        emptyHint={<>Search covers RFQs, orders, companies and items. Try one word, or press <Kbd>N</Kbd> to start an RFQ.</>}
      />
    </PaletteContext.Provider>
  )
}
