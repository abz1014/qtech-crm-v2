import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, CalendarCheck, ChartColumn, Import, Plus, Settings } from 'lucide-react'
import { navItemsForRole } from '@/app/navConfig'
import { settingsLinksFor } from '@/features/settings/settingsLinks'
import { CaptureContext } from '@/app/capture/useCapture'
import { PaletteContext, type PaletteApi } from '@/app/palette/usePalette'
import { CAPTURE_LABEL } from '@/app/shell/TopBar'
import { CommandPalette } from '@/ui/CommandPalette'
import { Kbd } from '@/ui/Kbd'
import { filterItems, type PaletteItem, type PaletteSource } from '@/ui/paletteSources'

/** Where the shortcut actions go. Capture opens the capture sheet (its palette row comes from the capture feature). */
const INTAKE_ROUTE = '/rfqs/new'
const TODAY_ROUTE = '/today'

/**
 * The places Jump to finds by name, besides the main destinations (audit: they were only in the avatar menu). Searched,
 * not shown idle. The Settings pages come from the same list as the Settings menu (settingsLinks.ts), so a role is offered
 * exactly what that menu offers. Reports is listed for admin and sales even when it is no longer a main destination:
 * /reports opens it, or redirects to where it lives now.
 */
function placesFor(role: string): PaletteItem[] {
  const places: PaletteItem[] = [
    { id: 'settings', label: 'Settings', icon: Settings, meta: 'Go to', href: '/settings' },
    ...settingsLinksFor(role).map(l => ({ id: `settings:${l.to}`, label: l.label, icon: l.icon, meta: 'Settings', href: l.to })),
  ]
  const navHasReports = navItemsForRole(role).some(n => n.path === '/reports')
  if (!navHasReports && (role === 'admin' || role === 'sales')) places.push({ id: 'reports', label: 'Reports', icon: ChartColumn, meta: 'Money', href: '/reports' })
  return places
}

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
  const openCapture = useContext(CaptureContext)?.openCapture

  const register = useCallback((source: PaletteSource) => {
    const tagged = { ...source, id: `${source.id}#${seq.current++}` }
    setExtra(list => [...list, tagged])
    return () => setExtra(list => list.filter(s => s !== tagged))
  }, [])

  const goTo = useMemo<PaletteSource>(() => {
    const items: PaletteItem[] = [
      ...navItemsForRole(role).map(n => ({ id: n.key, label: n.label, icon: n.icon, meta: 'Go to', href: n.path })),
      ...placesFor(role),
    ]
    return {
      id: 'go-to',
      group: 'Jump to',
      order: 5,
      search: q => filterItems(items, q),
    }
  }, [role])

  // Actions (A-89): idle rows in the palette, and the same keys work anywhere outside a text field: N, C, G then T.
  const actions = useMemo<PaletteSource>(() => {
    // "capture" and "paste" still find it: the old name, and the word people reach for.
    const captureItem: PaletteItem = { id: 'capture', label: CAPTURE_LABEL, meta: 'Action', keywords: ['capture', 'paste'], icon: Import, shortcut: ['C'], onSelect: () => openCapture?.() }
    const items: PaletteItem[] = [
      { id: 'new-rfq', label: 'New RFQ', meta: 'Go to intake', icon: Plus, shortcut: ['N'], href: INTAKE_ROUTE },
      captureItem,
      { id: 'go-today', label: 'Go to Today', icon: CalendarCheck, shortcut: ['G T'], href: TODAY_ROUTE },
      { id: 'new-company', label: 'New company', icon: Building2, href: '/companies?new=1' },
    ]
    // Typing "paste", "photo" or "capture" finds the paste-or-photo action; the other actions are idle-only (destinations answer typed text).
    return { id: 'actions', group: 'Actions', order: 90, idle: () => items, search: q => filterItems([captureItem], q) }
  }, [openCapture])

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
      if (k === 'n') {
        e.preventDefault()
        navigate(INTAKE_ROUTE)
      } else if (k === 'c' && openCapture) {
        e.preventDefault()
        openCapture()
      } else if (k === 't' && armed) {
        e.preventDefault()
        navigate(TODAY_ROUTE)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, openCapture])

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
