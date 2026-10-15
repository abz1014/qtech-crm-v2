import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { navItemsForRole } from '@/app/navConfig'
import { PaletteContext, type PaletteApi } from '@/app/palette/usePalette'
import { CommandPalette } from '@/ui/CommandPalette'
import { filterItems, type PaletteItem, type PaletteSource } from '@/ui/paletteSources'

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
      order: 100,
      idle: () => items,
      search: q => filterItems(items, q),
    }
  }, [role])

  const sources = useMemo(() => [...extra, goTo], [extra, goTo])
  const api = useMemo<PaletteApi>(() => ({ open: () => setOpen(true), register }), [register])

  return (
    <PaletteContext.Provider value={api}>
      {children}
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        sources={sources}
        onNavigate={(href, { newTab }) => (newTab ? window.open(href, '_blank', 'noopener') : navigate(href))}
        emptyHint="Search finds companies, contacts (name, phone, e-mail), RFQ numbers and customer references, and the places you can open from here."
      />
    </PaletteContext.Provider>
  )
}
