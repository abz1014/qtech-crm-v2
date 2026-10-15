import type { LucideIcon } from 'lucide-react'

// Types and helpers for command-palette sources (see CommandPalette.tsx).
export interface PaletteItem {
  id: string
  label: string
  /** Heading to group this row under, when a source returns several kinds at once (a search across companies, contacts and RFQs). Default: the source's own group. */
  group?: string
  /** Muted text on the right: "RFQ · bid due Tue 1 Dec". */
  meta?: string
  icon?: LucideIcon
  /** Keys shown as hints: ["G", "T"]. Display only. */
  shortcut?: string[]
  /** A route. The palette opens it through `onNavigate`, and remembers it under Recent. */
  href?: string
  /** Runs instead of navigating, for actions with no route. */
  onSelect?: (opts: { newTab: boolean }) => void
}

export interface PaletteSource {
  id: string
  /** Group heading ("Jump to", "Actions"). */
  group: string
  /** Lower first. Default 0; ties keep the order the sources were given. */
  order?: number
  idle?: () => PaletteItem[]
  search?: (query: string, signal: AbortSignal) => PaletteItem[] | Promise<PaletteItem[]>
}

/** Case-insensitive match helper for sources: keeps items whose label, meta or keywords contain every typed word. */
export function filterItems<T extends { label: string; meta?: string }>(items: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return items.slice()
  return items.filter(i => {
    const hay = `${i.label} ${i.meta ?? ''}`.toLowerCase()
    return words.every(w => hay.includes(w))
  })
}
